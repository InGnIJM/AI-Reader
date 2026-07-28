import { contextBridge, ipcRenderer } from 'electron';
const api = {
    getAppVersion: () => ipcRenderer.invoke('system:getVersion'),
};
contextBridge.exposeInMainWorld('api', api);
//# sourceMappingURL=index.js.map