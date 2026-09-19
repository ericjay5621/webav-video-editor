import { DraftProject } from './types';

const DATABASE_NAME = 'webav-h5-editor';
const STORE_NAME = 'drafts';
const LATEST_DRAFT_KEY = 'latest';

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('草稿数据库打开失败'));
  });
}

export async function saveDraft(project: DraftProject) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(project, LATEST_DRAFT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error || new Error('草稿保存失败'),
    );
  });
  database.close();
}

export async function loadDraft() {
  const database = await openDatabase();
  const project = await new Promise<DraftProject | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(LATEST_DRAFT_KEY);
    request.onsuccess = () => resolve((request.result as DraftProject) || null);
    request.onerror = () => reject(request.error || new Error('草稿读取失败'));
  });
  database.close();
  return project;
}
