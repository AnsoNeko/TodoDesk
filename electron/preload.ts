import { contextBridge, ipcRenderer } from 'electron';
import type { TodoAPI, Snapshot, UpdateState } from '../shared/model';
const api: TodoAPI = {
  command: (command) => ipcRenderer.invoke('todo:command', command),
  window: (action) => ipcRenderer.invoke('todo:window', action),
  copy: (text) => ipcRenderer.invoke('todo:copy', text),
  onChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => callback(snapshot);
    ipcRenderer.on('todo:changed', listener);
    return () => ipcRenderer.removeListener('todo:changed', listener);
  },
  update: (action) => ipcRenderer.invoke('todo:update', action),
  onUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
    ipcRenderer.on('todo:update-state', listener);
    return () => ipcRenderer.removeListener('todo:update-state', listener);
  },
};
contextBridge.exposeInMainWorld('todo', api);
