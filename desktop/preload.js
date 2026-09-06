/* Мост между окнами и главным процессом.
   Окна не имеют доступа к файловой системе и к сети напрямую:
   доступен только перечисленный ниже набор действий. */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('assistant', {
  consent: {
    accept: function () { return ipcRenderer.invoke('consent:accept'); },
    decline: function () { return ipcRenderer.invoke('consent:decline'); }
  },
  settings: {
    get: function () { return ipcRenderer.invoke('settings:get'); },
    set: function (patch) { return ipcRenderer.invoke('settings:set', patch); },
    setApiKey: function (key) { return ipcRenderer.invoke('settings:setApiKey', key); }
  },
  sources: {
    list: function () { return ipcRenderer.invoke('sources:list'); }
  },
  session: {
    start: function (options) { return ipcRenderer.invoke('session:start', options); },
    stop: function () { return ipcRenderer.invoke('session:stop'); },
    askNow: function () { return ipcRenderer.invoke('session:askNow'); }
  },
  overlay: {
    close: function () { return ipcRenderer.invoke('overlay:close'); },
    setOpacity: function (value) { return ipcRenderer.invoke('overlay:setOpacity', value); }
  },
  openExternal: function (url) { return ipcRenderer.invoke('app:openExternal', url); },
  on: function (channel, handler) {
    const allowed = ['session:status', 'session:hint'];
    if (allowed.indexOf(channel) < 0) return;
    ipcRenderer.on(channel, function (event, payload) { handler(payload); });
  }
});
