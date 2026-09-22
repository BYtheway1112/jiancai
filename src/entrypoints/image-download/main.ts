import { browser } from 'wxt/browser';
import {
    imageDownloadFilename,
    imageDownloadOutputFilename,
    imageDownloadTaskKey,
    validateImageUrl,
    type ImageDownloadTask,
} from '../../utils/image-download';
import { fetchPreparedImage } from '../../utils/image-fetch';

type DirectoryPickerWindow = Window & {
    showDirectoryPicker?: (options?: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

type FileState = 'pending' | 'saving' | 'success' | 'failed';

const taskId = new URLSearchParams(location.search).get('task');
const key = taskId ? imageDownloadTaskKey(taskId) : '';
const summary = document.querySelector<HTMLParagraphElement>('#summary')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const filesList = document.querySelector<HTMLOListElement>('#files')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save')!;
const pickerWindow = window as DirectoryPickerWindow;

let task: ImageDownloadTask | undefined;
let fileStates: FileState[] = [];
let errors: Array<string | undefined> = [];
let outputNames: Array<string | undefined> = [];
let workFolder: FileSystemDirectoryHandle | undefined;
let busy = false;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function setStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle('error', isError);
}

function renderFiles(): void {
    filesList.replaceChildren(...(task?.files || []).map((file, index) => {
        const item = document.createElement('li');
        const state = fileStates[index];
        const outputName = outputNames[index];
        const reason = errors[index];
        item.className = state;
        item.textContent = `${outputName || imageDownloadFilename(file.filename, index)} · ${
            state === 'success' ? '已保存' : state === 'saving' ? '保存中…' : state === 'failed' ? '失败' : '待保存'
        }`;
        if (reason) {
            const detail = document.createElement('small');
            detail.textContent = `（${reason}）`;
            item.append(detail);
        }
        return item;
    }));
}

async function fetchImage(file: ImageDownloadTask['files'][number], platform: NonNullable<ImageDownloadTask['platform']>): Promise<{ blob: Blob; extension: string }> {
    return fetchPreparedImage(file.url, platform);
}

async function writeFile(folder: FileSystemDirectoryHandle, filename: string, blob: Blob): Promise<void> {
    try {
        await folder.getFileHandle(filename);
        throw new Error('同名文件已存在，未覆盖');
    } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
    const file = await folder.getFileHandle(filename, { create: true });
    let writable: FileSystemWritableFileStream | undefined;
    try {
        writable = await file.createWritable();
        await writable.write(blob);
        await writable.close();
    } catch (error) {
        try { await writable?.abort(); } catch { /* keep the original failure */ }
        try { await folder.removeEntry(filename); } catch { /* remove only a possible partial file */ }
        throw error;
    }
}

async function chooseWorkFolder(): Promise<FileSystemDirectoryHandle> {
    if (workFolder) return workFolder;
    if (!pickerWindow.showDirectoryPicker) {
        throw new Error('当前 Chrome 不支持直接选择本地目录，请升级 Chrome；未开始保存');
    }
    const parent = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
    if (!task) throw new Error('下载任务不存在');
    for (let suffix = 1; suffix <= 10000; suffix += 1) {
        const name = suffix === 1 ? task.folderName : `${task.folderName} (${suffix})`;
        try {
            const candidate = await parent.getDirectoryHandle(name);
            let hasEntries = false;
            for await (const _entry of candidate.values()) {
                hasEntries = true;
                break;
            }
            if (hasEntries) continue;
            workFolder = candidate;
            return workFolder;
        } catch (error) {
            if (error instanceof DOMException && error.name === 'NotFoundError') {
                workFolder = await parent.getDirectoryHandle(name, { create: true });
                return workFolder;
            }
            if (error instanceof DOMException && error.name === 'TypeMismatchError') continue;
            throw error;
        }
    }
    throw new Error('无法创建唯一作品文件夹，请更换父目录后重试');
}

async function saveFiles(): Promise<void> {
    if (!task || busy) return;
    busy = true;
    saveButton.disabled = true;
    let completed = false;
    try {
        const folder = await chooseWorkFolder();
        const pending = task.files.map((_, index) => index).filter(index => fileStates[index] !== 'success');
        for (const index of pending) {
            const file = task.files[index];
            fileStates[index] = 'saving';
            errors[index] = undefined;
            renderFiles();
            setStatus(`正在保存 ${index + 1}/${task.files.length}…`);
            try {
                const fetched = await fetchImage(file, task.platform || 'xhs');
                const filename = imageDownloadOutputFilename(file.sourceIndex ?? index, fetched.extension);
                await writeFile(folder, filename, fetched.blob);
                outputNames[index] = filename;
                fileStates[index] = 'success';
            } catch (error) {
                fileStates[index] = 'failed';
                errors[index] = errorMessage(error);
            }
            renderFiles();
        }
        const failed = fileStates.filter(state => state === 'failed').length;
        const saved = fileStates.filter(state => state === 'success').length;
        if (failed) {
            saveButton.textContent = '重试失败项';
            setStatus(`已保存 ${saved}/${task.files.length} 张；${failed} 张失败。可点击“重试失败项”，不会覆盖已存在文件。`, true);
        } else {
            saveButton.textContent = '已全部保存';
            setStatus(`已按顺序保存 ${saved} 张图片到「${task.folderName}」`);
            await browser.storage.local.remove(key);
            completed = true;
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            setStatus('已取消选择目录，尚未开始保存');
        } else {
            setStatus(errorMessage(error), true);
        }
    } finally {
        busy = false;
        saveButton.disabled = completed;
    }
}

async function loadTask(): Promise<void> {
    if (!key) throw new Error('下载任务参数缺失');
    const stored = (await browser.storage.local.get(key) as Record<string, unknown>)[key] as ImageDownloadTask | undefined;
    if (!stored || !Array.isArray(stored.files) || !stored.files.length || typeof stored.folderName !== 'string') {
        throw new Error('下载任务不存在或已过期，请回到作品页重试');
    }
    const platform = stored.platform === 'dy' ? 'dy' : 'xhs';
    task = {
        platform,
        folderName: stored.folderName,
        createdAt: stored.createdAt,
        files: stored.files.map(file => ({ url: validateImageUrl(file.url, platform), filename: imageDownloadFilename(file.filename, file.sourceIndex ?? 0), sourceIndex: file.sourceIndex })),
    };
    fileStates = task.files.map(() => 'pending');
    errors = task.files.map(() => undefined);
    outputNames = task.files.map(() => undefined);
    summary.textContent = `${task.files.length} 张图片将保存到作品文件夹「${task.folderName}」`;
    renderFiles();
    if (!pickerWindow.showDirectoryPicker) {
        saveButton.disabled = true;
        setStatus('当前 Chrome 不支持直接选择本地目录，请升级 Chrome；未开始保存', true);
    }
}

saveButton.addEventListener('click', () => { void saveFiles(); });
void loadTask().catch(error => {
    saveButton.disabled = true;
    setStatus(errorMessage(error), true);
});
