/**
 * 导出处理逻辑 - 使用离屏渲染器
 */

import JSZip from 'jszip';
import { AnimationItem, ExportConfig } from '../types';
import { SpineRenderer } from './spineRenderer';
import { CanvasRecorder } from './recorder';
import { ExportManager, OffscreenRenderTask } from './offscreenRenderer';

export interface ExportCallbacks {
    onProgress: (current: number, total: number, currentName: string) => void;
    onItemStatusChange: (itemId: string, status: 'waiting' | 'exporting' | 'completed' | 'failed') => void;
}

export async function processExportWithOffscreen(
    selectedItems: AnimationItem[],
    config: ExportConfig,
    callbacks: ExportCallbacks,
    abortSignal?: AbortSignal
): Promise<number> {
    const { onProgress, onItemStatusChange } = callbacks;

    // 创建导出管理器
    const exportManager = new ExportManager();
    const zip = new JSZip();

    // 标记所有选中项为等待状态
    selectedItems.forEach(item => onItemStatusChange(item.id, 'waiting'));

    try {
        // 第一步: 扫描所有任务
        console.log('[导出] 正在扫描资产和动画...');
        const tasks: Array<{ item: AnimationItem; animation: string; task: OffscreenRenderTask }> = [];

        // 使用临时渲染器快速扫描动画列表
        const tempCanvas = document.createElement('canvas');
        const tempRenderer = new SpineRenderer(tempCanvas);

        for (const item of selectedItems) {
            if (abortSignal?.aborted) break;

            try {
                const animations = await tempRenderer.load(item.files);
                console.log(`[导出] 资产 "${item.name}" 包含 ${animations.length} 个动画:`, animations);

                for (const anim of animations) {
                    tasks.push({
                        item,
                        animation: anim,
                        task: {
                            assetName: item.name,
                            animation: anim,
                            files: item.files,
                            width: config.width,
                            height: config.height,
                            fps: config.fps,
                            format: config.format,
                            duration: config.duration,
                            backgroundColor: config.backgroundColor,
                            abortSignal: abortSignal
                        }
                    });
                }
            } catch (error) {
                console.error(`[导出] 扫描资产 "${item.name}" 失败:`, error);
                onItemStatusChange(item.id, 'failed');
            }
        }

        tempRenderer.dispose();

        const totalTasks = tasks.length;
        if (totalTasks === 0) return 0;

        console.log(`[导出] 共扫描到 ${totalTasks} 个导出任务,准备并行处理...`);
        onProgress(0, totalTasks, '准备导出...');

        // 第二步: 处理所有任务
        let completed = 0;

        // 我们使用一个简单的 promise 队列来控制并发, exportManager 内部已经有了 maxConcurrent
        const exportPromises = tasks.map(async ({ item, animation, task }, index) => {
            if (abortSignal?.aborted) return;

            try {
                const taskName = `${item.name} - ${animation}`;
                onProgress(completed + 1, totalTasks, taskName);
                onItemStatusChange(item.id, 'exporting');

                console.log(`[导出] [${index + 1}/${totalTasks}] 开始渲染: ${taskName}`);

                // 使用离屏渲染器导出
                const blob = await exportManager.exportTask(task);

                if (abortSignal?.aborted) return;

                // 确定文件名
                let ext: string;
                if (config.format === 'png-sequence' || config.format === 'jpg-sequence') {
                    ext = 'zip';
                } else if (config.format === 'mp4-h264') {
                    ext = 'mp4';
                } else {
                    ext = config.format.startsWith('webm') ? 'webm' : 'mp4';
                }

                const filename = `${item.name}_${animation}.${ext}`;

                // 将结果添加到主 ZIP 中
                zip.file(filename, blob);

                completed++;
                onProgress(completed, totalTasks, taskName);

                console.log(`[导出] ✓ [${completed}/${totalTasks}] 渲染完成并已添加至打包队列: ${filename}`);
            } catch (error) {
                console.error(`[导出] 渲染失败: ${item.name} - ${animation}`, error);
                onItemStatusChange(item.id, 'failed');
            }
        });

        // 等待所有渲染任务完成
        await Promise.all(exportPromises);

        if (abortSignal?.aborted) return completed;

        if (completed > 0) {
            onProgress(completed, totalTasks, '正在打包 ZIP 文件...');
            console.log(`[导出] 正在打包所有结果至压缩包...`);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const zipFilename = `SpineExport_${timestamp}.zip`;

            const finalZipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });

            CanvasRecorder.download(finalZipBlob, zipFilename);
            console.log(`[导出] ✓ 打包完成并开始下载: ${zipFilename}`);
        }

        selectedItems.forEach(item => {
            // 如果该资产下所有任务都成功了(或者至少有一个成功),标记为完成
            onItemStatusChange(item.id, 'completed');
        });

        return completed;
    } catch (error) {
        console.error("[导出] 流程遇到严重错误:", error);
        selectedItems.forEach(item => onItemStatusChange(item.id, 'failed'));
        throw error;
    }
}
