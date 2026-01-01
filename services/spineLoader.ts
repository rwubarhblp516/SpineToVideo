import { AnimationItem, SpineFiles } from '../types';

/**
 * 助手函数：根据后缀名判断文件类型
 */
export const getFileType = (filename: string) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.skel')) return 'skel';
  if (lower.endsWith('.spine')) return 'spine'; // Spine 项目源文件
  if (lower.endsWith('.atlas')) return 'atlas';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) return 'image';
  return 'unknown';
};

/**
 * 智能导入逻辑：扫描文件夹列表并自动识别资产
 * 规则：
 * 1. 一个资产是由 skeleton (.json/.skel) 和 atlas (.atlas) 共同定义的。
 * 2. 以包含 skeleton 的文件夹作为一个资产的根目录。
 * 3. 自动递归查找大文件夹下的所有子文件夹。
 * 4. 资产名称跟随其文件夹名称。
 */
export const groupFilesByDirectory = (fileList: FileList): AnimationItem[] => {
  const fileArray = Array.from(fileList);

  // 建立路径映射
  // 路径 -> 该路径下的文件分类
  const pathMap: Record<string, {
    skeleton: File | null;
    atlas: File | null;
    images: File[];
    skeletonType: 'skel' | 'json' | 'spine' | null;
  }> = {};

  const getEntry = (path: string) => {
    if (!pathMap[path]) {
      pathMap[path] = { skeleton: null, atlas: null, images: [], skeletonType: null };
    }
    return pathMap[path];
  };

  // 1. 预处理：将所有文件按文件夹路径归类
  fileArray.forEach((file) => {
    // webkitRelativePath: "Characters/Hero/skeleton.json"
    const parts = file.webkitRelativePath.split('/');
    parts.pop(); // 去掉文件名
    const dirPath = parts.join('/');

    // 忽略隐藏文件/文件夹
    if (file.name.startsWith('.') || parts.some(p => p.startsWith('.'))) return;

    const type = getFileType(file.name);
    const entry = getEntry(dirPath);

    if (type === 'skel' || type === 'json' || type === 'spine') {
      // 优先级：skel > json > spine
      const currentType = entry.skeletonType;
      let better = false;
      if (!entry.skeleton) {
        better = true;
      } else {
        if (currentType === 'spine' && (type === 'skel' || type === 'json')) better = true;
        else if (currentType === 'json' && type === 'skel') better = true;
      }
      if (better) {
        entry.skeleton = file;
        entry.skeletonType = type as any;
      }
    } else if (type === 'atlas') {
      // 如果已存在图集，且当前文件名更匹配骨骼名，则替换
      if (!entry.atlas) {
        entry.atlas = file;
      } else if (entry.skeleton && file.name.includes(entry.skeleton.name.split('.')[0])) {
        entry.atlas = file;
      }
    } else if (type === 'image') {
      entry.images.push(file);
    }
  });

  // 2. 识别“资产根目录” (既有骨骼也有图集的文件夹)
  const allPaths = Object.keys(pathMap).sort(); // 按路径排序，保证层级关系和名称顺序
  const assetRoots = allPaths.filter(path => {
    const e = pathMap[path];
    return e.skeleton && e.atlas;
  });

  // 3. 构建最终资产项
  const items: AnimationItem[] = [];

  assetRoots.forEach(rootPath => {
    const rootEntry = pathMap[rootPath];
    if (!rootEntry.skeleton || !rootEntry.atlas) return;

    // 为该资产收集所有相关图片
    // 逻辑：收集该文件夹下的图片，以及所有非“新资产根目录”的子文件夹下的图片
    const allImages: File[] = [...rootEntry.images];

    // 查找子目录中的图片
    allPaths.forEach(otherPath => {
      // 如果 otherPath 是 rootPath 的子目录，且 otherPath 自己不是另一个资产根
      if (otherPath.startsWith(rootPath + '/') && !assetRoots.includes(otherPath)) {
        allImages.push(...pathMap[otherPath].images);
      }
    });

    // 创建资产项
    items.push({
      id: crypto.randomUUID(),
      name: rootPath.split('/').pop() || 'Untitled',
      files: {
        skeleton: rootEntry.skeleton,
        atlas: rootEntry.atlas,
        images: allImages,
        basePath: rootPath
      },
      animationNames: [],
      defaultAnimation: '',
      status: 'idle'
    });
  });

  // 最终根据名称排序，提高易用性
  return items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
};

/**
 * 为资产创建 URL 映射
 */
export const createAssetUrls = (files: SpineFiles) => {
  const urls: Record<string, string> = {};

  if (files.skeleton) urls[files.skeleton.name] = URL.createObjectURL(files.skeleton);
  if (files.atlas) urls[files.atlas.name] = URL.createObjectURL(files.atlas);

  files.images.forEach(img => {
    // 同时映射完整路径（如果有）和纯文件名，提高加载兼容性
    urls[img.name] = URL.createObjectURL(img);
  });

  return urls;
};

/**
 * 释放 URL
 */
export const revokeAssetUrls = (urls: Record<string, string>) => {
  Object.values(urls).forEach(url => URL.revokeObjectURL(url));
};