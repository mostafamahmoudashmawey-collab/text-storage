/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Eye, EyeOff, Plus, User, Trash2, Pencil, Copy, Check, X, Star, Share2, Mic, Image as ImageIcon, UploadCloud, Bell, Send, ShieldAlert, Moon, Sun, Download, Smartphone } from 'lucide-react';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { sendP2P } from './p2p';
import { t, Language } from './i18n';

const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbyiEns9GDoPmwDTKM7WdmMghaKrB_K_QQ2CBuW__0CyZC2GS-axQOSC0H4WrUoW2A2xPQ/exec";

// Fetch all rows from the Google Sheet
const fetchAllGoogleSheetRows = async (retryCount = 0): Promise<any[][]> => {
  try {
    const urlParams = new URLSearchParams({ t: Date.now().toString() });
    const res = await fetch(`${GOOGLE_SHEETS_URL}?${urlParams.toString()}`, { 
        method: "GET"
    });
    if (!res.ok) {
        if (res.status === 429 && retryCount < 5) {
            await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
            return fetchAllGoogleSheetRows(retryCount + 1);
        }
        throw new Error(`Failed to fetch Google Sheet: ${res.status} ${res.statusText}`);
    }
    const data: any[][] = await res.json();
    return data;
  } catch (error) {
    if (retryCount < 5) {
        await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
        return fetchAllGoogleSheetRows(retryCount + 1);
    }
    throw error;
  }
};

// Append a row to the Google Sheet with automatic retries for maximum reliability
const appendToGoogleSheet = async (payload: any, retryCount = 0): Promise<any> => {
  try {
    const bodyStr = JSON.stringify(payload);
    // Browser restricts keepalive requests to small payloads (typically cumulative 64KB max)
    const canKeepAlive = bodyStr.length < 8192;
    
    await fetch(GOOGLE_SHEETS_URL, {
      method: "POST",
      body: bodyStr,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      mode: "no-cors",
      ...(canKeepAlive ? { keepalive: true } : {})
    });
    return {};
  } catch (error) {
    if (retryCount < 20) {
      // Exponential backoff
      await new Promise(r => setTimeout(r, Math.min(1000 * retryCount, 10000)));
      return appendToGoogleSheet(payload, retryCount + 1);
    }
    console.error("Google Sheets save error after retries", error);
    throw error;
  }
};

// Keep original image quality, but safely compress to fit Sheets length constraints beautifully!
const compressImageToSafeSize = (fileOrDataUrl: File | string): Promise<string> => {
  return new Promise((resolve) => {
    const handleLoadedImage = (img: HTMLImageElement) => {
      let maxDim = 800;
      let quality = 0.6;
      
      const attemptCompress = (): string => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
        }
        
        // Try WebP first for ultra efficiency, fall back to JPEG if needed
        let dataUrl = canvas.toDataURL('image/webp', quality);
        if (dataUrl.length > 48000) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        return dataUrl;
      };
      
      let finalDataUrl = attemptCompress();
      
      // If still too large, reduce dimension and quality on the fly
      while (finalDataUrl.length > 48000 && (maxDim > 100 || quality > 0.1)) {
        if (maxDim > 300) {
          maxDim -= 150;
        } else {
          quality = Math.max(0.1, quality - 0.15);
          maxDim = Math.max(100, maxDim - 50);
        }
        finalDataUrl = attemptCompress();
      }
      
      resolve(finalDataUrl);
    };

    if (typeof fileOrDataUrl === 'string') {
      const img = new Image();
      img.onload = () => handleLoadedImage(img);
      img.onerror = () => {
        // Fallback: If image loading fails, return a truncated fallback
        resolve(fileOrDataUrl.slice(0, 48000));
      };
      img.src = fileOrDataUrl;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => handleLoadedImage(img);
        img.onerror = () => {
          resolve((e.target?.result as string || '').slice(0, 48000));
        };
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(fileOrDataUrl);
    }
  });
};

const compressImage = (dataUrl: string): Promise<string> => {
  return compressImageToSafeSize(dataUrl);
};

interface TextItem {
  id: string;
  userId: string;
  text: string;
  timestamp: number;
  starred?: boolean;
  synced?: boolean;
  deleted?: boolean;
}

const resizeImageToWebP = (file: File): Promise<string> => {
  return compressImageToSafeSize(file);
};

const shuffleArray = (array: any[]) => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

const checkForgotPasswordSetup = async (id: string) => {
  const data = await fetchAllGoogleSheetRows();
  let userPass = null;
  const images: any[] = [];
  let isEnabledExplicitly = true;
  
  for (const row of data) {
     const rowId = String(row[0]);
     const rowType = String(row[1]);
     
     if (rowId === `${id}_SECIMG` && rowType === "USER_AUTH_SECURITY") {
        try {
            const parsed = JSON.parse(String(row[2]));
            if (typeof parsed.enabled === 'boolean') {
                isEnabledExplicitly = parsed.enabled;
            } else {
                isEnabledExplicitly = true;
            }
            if (parsed.images) {
                images.length = 0;
                for (let i=0; i<parsed.images.length; i++) images[i] = parsed.images[i];
            }
        } catch(e) {}
     } else if (rowId === id && rowType === "USER_AUTH") {
         userPass = String(row[2] ?? "").padStart(5, '0');
     }
  }
  
  const hasFiveImages = images.filter(img => img != null).length === 5;
  if (hasFiveImages) {
     return { enabled: isEnabledExplicitly, images, userPass };
  }
  return null;
};

const initLocalDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('my-app-db', 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains('texts')) {
        const store = database.createObjectStore('texts', { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
      }
      if (!database.objectStoreNames.contains('users')) {
        database.createObjectStore('users', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('notifications')) {
        const notifStore = database.createObjectStore('notifications', { keyPath: 'attemptId' });
        notifStore.createIndex('userId', 'userId', { unique: false });
      }
    };
  });
};

const TAB_ID = Math.random().toString(36).substring(2);
let lastLocalWriteTime = 0;
const pendingDeletedIds = new Set<string>();

const notifyTabSync = (userId: string) => {
  try {
    const bc = new BroadcastChannel(`app_sync_${userId}`);
    bc.postMessage({ type: 'sync_local', tabId: TAB_ID });
    bc.close();
  } catch (e) {}
};

const saveTextToDB = async (textItem: TextItem, isUpdate = false) => {
  lastLocalWriteTime = Date.now();
  
  // Save to local DB with synced = false so background loop can retry if needed
  const itemToSave = { ...textItem, synced: false };
  
  try {
    const localDb = await initLocalDB();
    await new Promise((resolve, reject) => {
      const tx = localDb.transaction('texts', 'readwrite');
      const store = tx.objectStore('texts');
      const req = store.put(itemToSave);
      req.onsuccess = resolve;
      req.onerror = reject;
    });
  } catch (e) {
    console.error("Local save error", e);
  }

  notifyTabSync(textItem.userId);

  try {
    // Priority direct Upload for maximum speed and zero drops
    await appendToGoogleSheet({
      action: isUpdate ? "UPDATE" : "ADD",
      id: textItem.id,
      userid: textItem.userId,
      text: textItem.text,
      timestamp: textItem.timestamp,
      starred: textItem.starred ? 1 : 0
    });
    
    // Mark as synced locally so the pending counter drops smoothly one by one
    try {
      const localDb = await initLocalDB();
      await new Promise<void>((resolve, reject) => {
        const tx = localDb.transaction('texts', 'readwrite');
        const store = tx.objectStore('texts');
        const req = store.put({ ...itemToSave, synced: true });
        req.onsuccess = () => resolve();
        req.onerror = reject;
      });
      // Notify this tab so it updates its texts state
      window.dispatchEvent(new CustomEvent('local_item_synced', { detail: textItem.id }));
      // And notify other tabs
      notifyTabSync(textItem.userId);
    } catch (e) {}

  } catch (e) {
    console.error("Google Sheets save error", e);
  }
  return true;
};

const getTextsFromLocalDB = async (userId: string): Promise<TextItem[]> => {
  let texts: TextItem[] = [];
  try {
    const localDb = await initLocalDB();
    texts = await new Promise<TextItem[]>((resolve, reject) => {
      const tx = localDb.transaction('texts', 'readonly');
      const store = tx.objectStore('texts');
      const index = store.index('userId');
      const req = index.getAll(userId);
      req.onsuccess = () => {
         const items = req.result.filter((i: any) => !i.deleted && !i.id.startsWith('USER_LANG_'));
         resolve(items.sort((a, b) => b.timestamp - a.timestamp));
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error("Local fetch error", e);
  }
  return texts;
};

const syncTextsFromRemoteDB = async (userId: string, currentPassword?: string, skipTexts: boolean = false): Promise<{ passwordMismatch?: boolean, attempts?: any[], chats?: any[], language?: string } | void> => {
  try {
    const data = await fetchAllGoogleSheetRows();
    const textsMap = new Map<string, TextItem>();
    const deletedIds = new Set<string>();
    let deleteAllMarkerTime = 0;
    
    let remotePasswordStr: string | null = null;
    let lockoutExpiry = 0;
    let remoteLanguage: string | undefined = undefined;
    
    const attempts: any[] = [];
    const responses: any[] = [];
    const chats: any[] = [];

    // Process items sequentially to always keep the latest version.
    for (const row of data) {
      const rowId = String(row[0]);
      const rowUser = String(row[1]);
      
      if (rowId === `USER_LANG_${userId}` && rowUser === userId) {
          remoteLanguage = String(row[2]);
      } else if (rowId === userId && rowUser === "USER_AUTH") {
        remotePasswordStr = String(row[2] ?? "").padStart(5, '0');
      } else if (rowId === `${userId}_LOCKOUT` && rowUser === "USER_AUTH_LOCKOUT") {
        lockoutExpiry = Math.max(lockoutExpiry, Number(row[2]));
      } else if (rowId === `${userId}_SECIMG` && rowUser === "USER_AUTH_SECURITY") {
         try {
            const parsed = JSON.parse(String(row[2]));
            if (parsed) {
                localStorage.setItem(`fp_setup_${userId}`, String(row[2]));
            }
         } catch(e) {}
      } else if (rowUser === "USER_AUTH_ATTEMPT" && rowId.startsWith(`ATTEMPT_${userId}_`)) {
          try { attempts.push(JSON.parse(String(row[2]))); } catch(e){}
      } else if (rowUser === "USER_AUTH_RES" && rowId.startsWith(`RES_${userId}_`)) {
          try { responses.push(JSON.parse(String(row[2]))); } catch(e){}
      } else if (rowUser === "USER_AUTH_CHAT" && rowId.startsWith(`CHAT_${userId}_`)) {
          try { chats.push(JSON.parse(String(row[2]))); } catch(e){}
      } else if (rowUser === "DELETED" && String(row[2]) === `[[DELETE_ALL]]_${userId}`) {
          textsMap.clear();
          deletedIds.clear();
          deleteAllMarkerTime = Number(row[3]);
      } else if (rowUser === String(userId) || rowUser === "DELETED") {
        if (Number(row[4]) === -1 || String(row[2]) === "[[DELETED]]" || rowUser === "DELETED") {
            textsMap.delete(rowId);
            deletedIds.add(rowId);
        } else if (rowUser === String(userId)) {
            textsMap.set(rowId, {
                id: rowId,
                userId: rowUser,
                text: String(row[2]),
                timestamp: Number(row[3]),
                starred: Number(row[4]) === 1,
                synced: true
            });
            deletedIds.delete(rowId);
        }
      }
    }

    if (lockoutExpiry > Date.now()) {
      localStorage.setItem(`login_lockout_${userId}`, lockoutExpiry.toString());
    }

    if (currentPassword && remotePasswordStr && remotePasswordStr !== currentPassword && parseInt(remotePasswordStr, 10) !== parseInt(currentPassword, 10)) {
      return { passwordMismatch: true, language: remoteLanguage };
    }

    
    const remoteTexts = Array.from(textsMap.values())
        .filter(t => !pendingDeletedIds.has(t.id))
        .sort((a, b) => b.timestamp - a.timestamp);
    
    const mergedAttempts = attempts.map(a => {
       const res = responses.slice().reverse().find((r: any) => r.attemptId === a.attemptId);
       return {
         ...a,
         action: res ? res.action : 'PENDING',
         pass: res ? res.pass : null
       };
    });

    if (skipTexts) {
       return { attempts: mergedAttempts, chats, language: remoteLanguage };
    }

    if (remoteTexts.length > 0 || deletedIds.size > 0 || deleteAllMarkerTime > 0) {
      try {
        const localDb = await initLocalDB();
        
        if (deleteAllMarkerTime > 0) {
          const localTexts = await new Promise<any[]>((resolve, reject) => {
            const tx = localDb.transaction('texts', 'readonly');
            const store = tx.objectStore('texts');
            const index = store.index('userId');
            const req = index.getAll(userId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          
          const textsToDelete = localTexts.filter((t: any) => t.timestamp <= deleteAllMarkerTime);
          
          if (textsToDelete.length > 0) {
            await new Promise<void>((resolve, reject) => {
              const tx = localDb.transaction('texts', 'readwrite');
              const store = tx.objectStore('texts');
              let count = 0;
              textsToDelete.forEach((t: any) => {
                const req = store.delete(t.id);
                req.onsuccess = () => {
                  count++;
                  if (count === textsToDelete.length) resolve();
                };
                req.onerror = () => reject(req.error);
              });
            });
          }
        }

        await new Promise<void>((resolve, reject) => {
          const tx = localDb.transaction('texts', 'readwrite');
          const store = tx.objectStore('texts');
          
          let putCount = 0;
          let deleteCount = 0;
          
          const checkDone = () => {
             if (putCount === remoteTexts.length && deleteCount === deletedIds.size) resolve();
          };
          
          remoteTexts.forEach(t => {
              const getReq = store.get(t.id);
              getReq.onsuccess = () => {
                 const localText = getReq.result;
                 if (localText && localText.synced === false) {
                     // Keep local pending edit, don't overwrite
                     putCount++;
                     checkDone();
                 } else {
                     const putReq = store.put(t);
                     putReq.onsuccess = () => { putCount++; checkDone(); };
                     putReq.onerror = () => reject(putReq.error);
                 }
              };
              getReq.onerror = () => reject(getReq.error);
          });
          
          Array.from(deletedIds).forEach(id => {
             const req = store.delete(id);
             req.onsuccess = () => {
                deleteCount++;
                checkDone();
             };
             req.onerror = () => reject(req.error);
          });
          
          if (remoteTexts.length === 0 && deletedIds.size === 0) resolve();
        });
      } catch (localErr) {
        console.error("Failed to save remote texts to local DB", localErr);
      }
    }
    
    return { attempts: mergedAttempts, chats, language: remoteLanguage };
  } catch (e: any) {
    if (e.message && e.message.includes("Failed to fetch")) {
       // Silently ignore intermittent network/rate-limit fetch errors
       console.warn("Sync skipped due to network/rate-limit error.");
    } else {
       console.error("Google Sheets sync error", e);
    }
  }
};

const deleteTextsFromDB = async (ids: string[], userId?: string, isAll: boolean = false) => {
  if (ids.length === 0) return true;
  lastLocalWriteTime = Date.now();
  
  if (isAll) {
    pendingDeletedIds.clear();
    // We don't mark all as pending since local DB is cleared, but just in case
  } else {
    ids.forEach(id => pendingDeletedIds.add(id));
  }
  
  try {
    const localDb = await initLocalDB();
    await new Promise((resolve, reject) => {
      const tx = localDb.transaction('texts', 'readwrite');
      const store = tx.objectStore('texts');
      ids.forEach(id => {
         const getReq = store.get(id);
         getReq.onsuccess = () => {
             if (getReq.result) {
                 store.put({ ...getReq.result, deleted: true, synced: false });
             } else {
                 store.put({ id, userId: userId || "", text: "", timestamp: Date.now(), deleted: true, synced: false });
             }
         };
      });
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch (e) {
    console.error("Local delete error", e);
  }

  if (userId) {
    notifyTabSync(userId);
  }

  try {
    if (isAll && userId) {
      await appendToGoogleSheet({
          action: "DELETE_ALL",
          id: "DELETE_ALL",
          userid: "DELETED",
          text: "[[DELETE_ALL]]_" + userId,
          timestamp: Date.now(),
          starred: -1
      });
    } else {
      // Parallel processing for maximum speed to Google Sheets
      await Promise.all(ids.map(id => 
         appendToGoogleSheet({
             action: "DELETE",
             id,
             userid: "DELETED",
             text: "[[DELETED]]",
             timestamp: Date.now(),
             starred: -1
         })
      ));
    }
  } catch (e) {
    console.error("Google Sheets delete error", e);
  }
  return true;
};

const registerUser = async (id: string, pass: string) => {
  let success = false;
  try {
    const localDb = await initLocalDB();
    await new Promise((resolve, reject) => {
      const tx = localDb.transaction('users', 'readwrite');
      const store = tx.objectStore('users');
      const req = store.put({ id, password: pass });
      req.onsuccess = resolve;
      req.onerror = reject;
    });
    success = true;
  } catch (e) {
    console.error("Local register error", e);
  }

  try {
    await appendToGoogleSheet({
        action: "ADD",
        id,
        userid: "USER_AUTH",
        text: pass,
        timestamp: Date.now(),
        starred: 0
    });
    success = true;
  } catch (e) {
    console.error("Google Sheets register error", e);
  }
  return success;
};

const loginUser = async (id: string, pass: string): Promise<{isValid: boolean; error?: string; syncedTexts?: TextItem[]}> => {
  let userExists = false;
  let validPassword = false;

  try {
    const localDb = await initLocalDB();
    const user: any = await new Promise((resolve, reject) => {
      const tx = localDb.transaction('users', 'readonly');
      const store = tx.objectStore('users');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = reject;
    });
    if (user) {
      userExists = true;
      if (user.password === pass) {
        validPassword = true;
      }
    }
  } catch (e) {
    console.error("Local login error", e);
  }

  try {
    const data = await fetchAllGoogleSheetRows();
    let currentPass = null;
    let found = false;
    let lockoutExpiry = 0;
    
    const textsMap = new Map<string, TextItem>();

    for (const row of data) {
      const rowId = String(row[0]);
      const rowUser = String(row[1]);
      const rowTypeOrUser = String(row[1]);

      if (rowId === id && rowUser === "USER_AUTH") {
        found = true;
        currentPass = String(row[2] ?? "").padStart(5, '0'); // pad left with zeros safely
      } else if (rowId === `${id}_LOCKOUT` && rowUser === "USER_AUTH_LOCKOUT") {
        lockoutExpiry = Math.max(lockoutExpiry, Number(row[2]));
      } else if (rowId === `${id}_SECIMG` && rowUser === "USER_AUTH_SECURITY") {
         try {
            const parsed = JSON.parse(String(row[2]));
            if (parsed) {
                localStorage.setItem(`fp_setup_${id}`, String(row[2]));
            }
         } catch(e) {}
      }

      // Text extracting
      if (rowTypeOrUser === id || rowTypeOrUser === "DELETED") {
        if (Number(row[4]) === -1 || String(row[2]) === "[[DELETED]]" || rowTypeOrUser === "DELETED") {
            textsMap.delete(rowId);
        } else if (rowTypeOrUser === id) {
            textsMap.set(rowId, {
                id: rowId,
                userId: rowUser,
                text: String(row[2]),
                timestamp: Number(row[3]),
                starred: Number(row[4]) === 1,
                synced: true
            });
        }
      }
    }

    if (lockoutExpiry > Date.now()) {
      localStorage.setItem(`login_lockout_${id}`, lockoutExpiry.toString());
      return { isValid: false, error: 'accountLocked' };
    }

    if (found) {
      userExists = true;
      if (currentPass === pass || (currentPass && pass && parseInt(currentPass, 10) === parseInt(pass, 10))) {
        validPassword = true;
        try {
          const localDb = await initLocalDB();
          await new Promise((resolve, reject) => {
            const tx = localDb.transaction('users', 'readwrite');
            const store = tx.objectStore('users');
            const req = store.put({ id, password: pass });
            req.onsuccess = resolve;
            req.onerror = reject;
          });
        } catch (err) {}
        
        // Save extracted texts locally
        const remoteTexts = Array.from(textsMap.values())
            .filter(t => !pendingDeletedIds.has(t.id))
            .sort((a, b) => b.timestamp - a.timestamp);
        if (remoteTexts.length > 0) {
          try {
            const localDb = await initLocalDB();
            await new Promise<void>((resolve, reject) => {
              const tx = localDb.transaction('texts', 'readwrite');
              const store = tx.objectStore('texts');
              let putCount = 0;
              remoteTexts.forEach(item => {
                const getReq = store.get(item.id);
                getReq.onsuccess = () => {
                   const localText = getReq.result;
                   if (localText && localText.synced === false) {
                       putCount++;
                       if (putCount === remoteTexts.length) resolve();
                   } else {
                       const putReq = store.put(item);
                       putReq.onsuccess = () => {
                         putCount++;
                         if (putCount === remoteTexts.length) resolve();
                       };
                       putReq.onerror = reject;
                   }
                };
                getReq.onerror = reject;
              });
            });
          } catch (e) {
            console.error("Local sync error", e);
          }
        }
        
        return { isValid: true, syncedTexts: remoteTexts };
      } else {
        validPassword = false;
      }
    } else if (validPassword) {
      return { isValid: true };
    }
  } catch (e: any) {
    console.error("Google Sheets login error", e);
    if (validPassword) {
      return { isValid: true };
    }
    return { isValid: false, error: 'serverError' };
  }
  
  if (!userExists) {
    return { isValid: false, error: 'idNotFound' };
  } else if (!validPassword) {
    return { isValid: false, error: 'wrongPassword' };
  }
  
  return { isValid: false, error: 'unknownError' };
};

const updatePasswordInDB = async (id: string, newPass: string) => {
  try {
    const localDb = await initLocalDB();
    await new Promise((resolve, reject) => {
      const tx = localDb.transaction('users', 'readwrite');
      const store = tx.objectStore('users');
      const req = store.put({ id, password: newPass });
      req.onsuccess = resolve;
      req.onerror = reject;
    });
  } catch (e) {
    console.error("Local update password error", e);
  }

  try {
    await appendToGoogleSheet({
        action: "UPDATE",
        id,
        userid: "USER_AUTH",
        text: newPass,
        timestamp: Date.now(),
        starred: 0
    });
  } catch (e) {
    console.error("Google Sheets update password error", e);
  }
};

export default function App() {
  const [language, setLanguage] = useState<Language>('en');
  const [tempLanguage, setTempLanguage] = useState<Language | null>(null);
  const [showLanguagePopup, setShowLanguagePopup] = useState(false);
  const [currentView, setCurrentView] = useState<'home' | 'signup' | 'login' | 'dashboard'>('home');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showAndroidInstallModal, setShowAndroidInstallModal] = useState(false);
  const [isAndroidDevice, setIsAndroidDevice] = useState(false);
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [showManualInstructions, setShowManualInstructions] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    const isAndroid = /android/.test(ua);
    const isMobile = /iphone|ipad|ipod|android|blackberry|iemobile|opera mini/.test(ua);
    setIsAndroidDevice(isAndroid);
    setIsMobileDevice(isMobile);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      
      const hasPrompted = sessionStorage.getItem('pwa_install_prompted');
      if (!hasPrompted) {
        setTimeout(() => {
          setShowAndroidInstallModal(true);
          sessionStorage.setItem('pwa_install_prompted', 'true');
        }, 1500);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const hasPrompted = sessionStorage.getItem('pwa_install_prompted');
    if (isMobile && !hasPrompted) {
      setTimeout(() => {
        setShowAndroidInstallModal(true);
        sessionStorage.setItem('pwa_install_prompted', 'true');
      }, 2500);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`Install outcome: ${outcome}`);
      setDeferredPrompt(null);
      setShowAndroidInstallModal(false);
    } else {
      setShowManualInstructions(true);
    }
  };

  const [generatedId, setGeneratedId] = useState('');
  const [password, setPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  
  const [loginId, setLoginId] = useState('');
  const [loginIdError, setLoginIdError] = useState('');
  const [loginHasFpEnabled, setLoginHasFpEnabled] = useState<boolean | null>(null);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginPasswordError, setLoginPasswordError] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [currentUserId, setCurrentUserId] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');

  const displayLang: Language = currentUserId ? language : 'en';

  useEffect(() => {
    const savedLang = localStorage.getItem('website_language');
    if (savedLang === 'en' || savedLang === 'ar') {
      setLanguage(savedLang);
    }
    const savedSession = localStorage.getItem('userSession');
    if (savedSession) {
      try {
        const { id, password } = JSON.parse(savedSession);
        if (id && password) {
          setCurrentUserId(id);
          setCurrentPassword(password);
          setCurrentView('dashboard');
        }
      } catch (e) {}
    } else {
      initLocalDB().then(localDb => {
        const tx = localDb.transaction('users', 'readonly');
        const store = tx.objectStore('users');
        const req = store.getAll();
        req.onsuccess = () => {
          const users = req.result;
          if (users && users.length > 0) {
            const lastUser = users[users.length - 1];
            // Only auto-login if the user hasn't explicitly logged out
            if (localStorage.getItem('explicitLogout') !== 'true') {
              setCurrentUserId(lastUser.id);
              setCurrentPassword(lastUser.password);
              setCurrentView('dashboard');
              saveSession(lastUser.id, lastUser.password);
            }
          }
        };
      }).catch(() => {});
    }
  }, []);

  const saveSession = (id: string, pass: string) => {
    localStorage.setItem('userSession', JSON.stringify({ id, password: pass }));
    localStorage.removeItem('explicitLogout');
  };

  const handleLogout = () => {
    const idToRemove = currentUserId;
    
    // Log out all accepted devices to synchronize logout
    const acceptedDevices = securityAttempts.filter(a => a.action === 'ACCEPT');
    acceptedDevices.forEach(device => {
        appendToGoogleSheet({
           action: "ADD",
           id: `RES_${idToRemove}_${device.attemptId}`,
           userid: "USER_AUTH_RES",
           text: JSON.stringify({ action: 'FORCE_LOGOUT', attemptId: device.attemptId }),
           timestamp: Date.now(),
           starred: 0
        });
    });

    localStorage.removeItem('userSession');
    localStorage.removeItem(`current_attemptid_${idToRemove}`);
    localStorage.setItem('explicitLogout', 'true');
    setCurrentUserId('');
    setCurrentPassword('');
    setCurrentView('home');
    setShowUserIdPopup(false);
    setFpSetupImages([]);
    
    // Remove the user from local DB so they can't login locally with old password
    if (idToRemove) {
      initLocalDB().then(localDb => {
        const tx = localDb.transaction('users', 'readwrite');
        const store = tx.objectStore('users');
        store.delete(idToRemove);
      }).catch(() => {});
    }
  };

  const [showUserIdPopup, setShowUserIdPopup] = useState(false);
  const [showUserIdPassword, setShowUserIdPassword] = useState(false);
  const [showVerifyPassword, setShowVerifyPassword] = useState(false);
  const [showDeviceVerifyPopup, setShowDeviceVerifyPopup] = useState(false);
  const [verifyAction, setVerifyAction] = useState<'view' | 'edit' | 'setup_forgot_pwd' | 'toggle_forgot_pwd' | 'reject_device' | 'accept_device' | 'chat_device' | 'logout_device' | 'ban_device'>('view');
  
  const [showForgotPasswordSetup, setShowForgotPasswordSetup] = useState(false);
  const [isForgotPasswordEnabled, setIsForgotPasswordEnabled] = useState(false);
  const [fpSetupImages, setFpSetupImages] = useState<{dataUrl: string, keyword: string}[]>([]);
  const [initialFpSetupImagesStr, setInitialFpSetupImagesStr] = useState('');
  const [fpSetupLoading, setFpSetupLoading] = useState(false);
  const [showForgotPwdRecoveryModal, setShowForgotPwdRecoveryModal] = useState(false);
  const [loadedImagesCount, setLoadedImagesCount] = useState(0);
  const [forgotPasswordLockout, setForgotPasswordLockout] = useState(0);
  const [forgotPwdRecoveryStep, setForgotPwdRecoveryStep] = useState(0);

  useEffect(() => {
    if (showForgotPwdRecoveryModal) {
      const timer = setTimeout(() => {
        setLoadedImagesCount(100); // force hide loader
      }, 12000);
      return () => clearTimeout(timer);
    }
  }, [showForgotPwdRecoveryModal]);
  const [recoverySecImages, setRecoverySecImages] = useState<any[]>([]);
  const [recoveryOptions, setRecoveryOptions] = useState<any[]>([]);
  const [recoverySelected, setRecoverySelected] = useState<string[]>([]);
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryUserPass, setRecoveryUserPass] = useState('');
  
  useEffect(() => {
    if (loginId.length === 5) {
      const cachedSetup = localStorage.getItem(`fp_setup_${loginId}`);
      if (cachedSetup) {
         try {
            const parsed = JSON.parse(cachedSetup);
            setLoginHasFpEnabled(!!(parsed.enabled !== false && parsed.images && parsed.images.length === 5));
         } catch(e) {}
      } else {
         setLoginHasFpEnabled(null);
      }
      
      checkForgotPasswordSetup(loginId).then(setup => {
         if (setup) {
             setLoginHasFpEnabled(setup.enabled && setup.images && setup.images.length === 5);
             localStorage.setItem(`fp_setup_${loginId}`, JSON.stringify({ enabled: setup.enabled, images: setup.images || [] }));
         } else {
             setLoginHasFpEnabled(false);
         }
      }).catch(() => {});
    } else {
      setLoginHasFpEnabled(false);
    }
  }, [loginId]);

  const [lockoutChatVisible, setLockoutChatVisible] = useState(false);
  const [lockoutChatMessages, setLockoutChatMessages] = useState<any[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [searchQuery, setSearchQuery] = useState('');

  // P2P Listeners
  useEffect(() => {
     if (currentUserId && currentView === 'dashboard') {
         let peer: any;
         import('peerjs').then((module) => {
             const Peer = module.Peer || module.default;
             peer = new Peer(`app_owner_${currentUserId}`);
             peer.on('connection', (conn: any) => {
                 conn.on('data', (data: any) => {
                     if (data.type === 'NEW_ATTEMPT') {
                         setSecurityAttempts(prev => {
                             if (prev.some(a => a.attemptId === data.attempt.attemptId)) return prev;
                             return [...prev, data.attempt];
                         });
                     } else if (data.type === 'CHAT') {
                         setChatsData(prev => {
                             if (prev.some(c => c.time === data.chat.time && c.message === data.chat.message)) return prev;
                             return [...prev, data.chat];
                         });
                     }
                 });
             });
         }).catch(() => {});
         return () => { if (peer) peer.destroy(); };
     }
  }, [currentUserId, currentView]);

  useEffect(() => {
     if (lockoutChatVisible && loginId) {
         const attemptId = localStorage.getItem(`lockout_attemptid_${loginId}`);
         if (attemptId) {
             let peer: any;
             import('peerjs').then((module) => {
                 const Peer = module.Peer || module.default;
                 peer = new Peer(`app_attacker_${loginId}_${attemptId}`);
                 peer.on('connection', (conn: any) => {
                     conn.on('data', (data: any) => {
                         if (data.type === 'CHAT') {
                             setLockoutChatMessages(prev => {
                                 if (prev.some(c => c.time === data.chat.time && c.message === data.chat.message)) return prev;
                                 return [...prev, data.chat];
                             });
                         }
                     });
                 });
             }).catch(() => {});
             return () => { if (peer) peer.destroy(); };
         }
     }
  }, [lockoutChatVisible, loginId]);

  const [texts, setTexts] = useState<TextItem[]>([]);
  const sortedTexts = useMemo(() => {
    let filtered = texts.slice();
    if (searchQuery.trim()) {
       const lowerQ = searchQuery.toLowerCase();
       filtered = filtered.filter(t => t.text.toLowerCase().includes(lowerQ));
    }
    return filtered.sort((a, b) => {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      return b.timestamp - a.timestamp;
    });
  }, [texts, searchQuery]);
  
  const [securityAttempts, setSecurityAttempts] = useState<any[]>([]);
  const [chatsData, setChatsData] = useState<any[]>([]);
  const [activeChatAttempt, setActiveChatAttempt] = useState<any | null>(null);
  const [showOwnerChatPopup, setShowOwnerChatPopup] = useState(false);
  const [chatInputValue, setChatInputValue] = useState('');
  
  const [hiddenNotifications, setHiddenNotifications] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (currentUserId) {
        initLocalDB().then(db => {
           const tx = db.transaction('notifications', 'readonly');
           const store = tx.objectStore('notifications');
           const index = store.index('userId');
           const req = index.getAll(currentUserId);
           req.onsuccess = () => {
             if (req.result && req.result.length > 0) {
                setSecurityAttempts(prev => {
                   // only set if empty to avoid overwriting fresher network data
                   if (prev.length === 0) return req.result;
                   return prev;
                });
             }
           };
        }).catch(()=>{});
        
        const stored = localStorage.getItem(`hidden_notifications_${currentUserId}`);
        if (stored) {
            try { setHiddenNotifications(new Set(JSON.parse(stored))); } catch(e) {}
        } else {
            setHiddenNotifications(new Set());
        }
    } else {
        setHiddenNotifications(new Set());
    }
  }, [currentUserId]);

  useEffect(() => {
    if (currentUserId) {
       localStorage.setItem(`hidden_notifications_${currentUserId}`, JSON.stringify(Array.from(hiddenNotifications)));
    }
  }, [hiddenNotifications, currentUserId]);

  const activeSecurityAttempts = useMemo(() => {
     return securityAttempts.filter(a => (a.action === 'PENDING' || a.action === 'CHAT') && !hiddenNotifications.has(a.attemptId));
  }, [securityAttempts, hiddenNotifications]);

  const notificationsList = useMemo(() => {
     return securityAttempts.filter(a => !hiddenNotifications.has(a.attemptId)).slice().reverse();
  }, [securityAttempts, hiddenNotifications]);

  const pendingCount = useMemo(() => texts.filter(t => t.synced === false).length, [texts]);
  const recentTextAdditionsCount = useMemo(() => {
    return texts.filter(t => !t.text.startsWith('data:image/')).length;
  }, [texts]);
  const recentImageAdditionsCount = useMemo(() => {
    return texts.filter(t => t.text.startsWith('data:image/')).length;
  }, [texts]);

  const [verifyPasswordInput, setVerifyPasswordInput] = useState('');
  const [verifyError, setVerifyError] = useState(false);
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [showAddTextPopup, setShowAddTextPopup] = useState(false);
  const [showAddImagePopup, setShowAddImagePopup] = useState(false);
  const [showNotificationsPopup, setShowNotificationsPopup] = useState(false);
  const [prevSecurityAttemptsCount, setPrevSecurityAttemptsCount] = useState(0);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());
  const notifScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentUserId) {
      const stored = localStorage.getItem(`read_notifications_${currentUserId}`);
      if (stored) {
         try { setReadNotifications(new Set(JSON.parse(stored))); } catch(e) {}
      } else {
         setReadNotifications(new Set());
      }
    }
  }, [currentUserId]);

  const markNotifAsRead = useCallback((attemptId: string) => {
     setReadNotifications(prev => {
        if (prev.has(attemptId)) return prev;
        const next = new Set(prev);
        next.add(attemptId);
        if (currentUserId) localStorage.setItem(`read_notifications_${currentUserId}`, JSON.stringify(Array.from(next)));
        return next;
     });
  }, [currentUserId]);

  const unreadNotifsCount = useMemo(() => {
      return activeSecurityAttempts.filter(a => !readNotifications.has(a.attemptId)).length;
  }, [activeSecurityAttempts, readNotifications]);
  const hasUnreadNotifs = unreadNotifsCount > 0;

  useEffect(() => {
     if (!showNotificationsPopup) return;
     const container = notifScrollRef.current;
     if (!container) return;

     const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
           if (entry.isIntersecting) {
               const id = entry.target.getAttribute('data-attempt-id');
               if (id) markNotifAsRead(id);
           }
        });
     }, {
         root: container,
         rootMargin: "-30% 0px -30% 0px",
         threshold: 0
     });

     const elements = container.querySelectorAll('.notification-item');
     elements.forEach(el => observer.observe(el));

     return () => observer.disconnect();
  }, [showNotificationsPopup, notificationsList, markNotifAsRead]);


  const [isBellShaking, setIsBellShaking] = useState(false);

  useEffect(() => {
     if (activeSecurityAttempts.length > prevSecurityAttemptsCount) {
        const hasRecent = activeSecurityAttempts.some(a => Date.now() - a.time < 15000);
        if (hasRecent) {
           setIsBellShaking(true);
           setTimeout(() => setIsBellShaking(false), 2000);
        }
     }
     setPrevSecurityAttemptsCount(activeSecurityAttempts.length);
  }, [activeSecurityAttempts, prevSecurityAttemptsCount]);
  const [imageCooldownRemaining, setImageCooldownRemaining] = useState(0);

  useEffect(() => {
    const checkCooldown = () => {
      if (!currentUserId || texts.length === 0) {
        setImageCooldownRemaining(0);
        return;
      }
      // Get all images for the current user
      const userImages = texts.filter(t => t.userId === currentUserId && t.text.startsWith('data:image/'));
      if (userImages.length === 0) {
        setImageCooldownRemaining(0);
        return;
      }
      
      // Find the most recently added image
      const latestImage = userImages.reduce((prev, current) => (prev.timestamp > current.timestamp) ? prev : current);
      const timeElapsed = Date.now() - latestImage.timestamp;
      
      // 15 seconds cooldown
      if (timeElapsed >= 0 && timeElapsed < 15000) {
        setImageCooldownRemaining(Math.ceil((15000 - timeElapsed) / 1000));
      } else if (timeElapsed < 0 && timeElapsed > -15000) {
        // Handle slight clock mismatch where someone else's clock is ahead
        setImageCooldownRemaining(Math.ceil(15 - (timeElapsed / 1000)));
      } else {
        setImageCooldownRemaining(0);
      }
    };

    checkCooldown();
    const interval = setInterval(checkCooldown, 1000);
    return () => clearInterval(interval);
  }, [texts, currentUserId]);

  const [showEditTextPopup, setShowEditTextPopup] = useState(false);
  const [editTextItem, setEditTextItem] = useState<TextItem | null>(null);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newText, setNewText] = useState('');
  const [editTextInput, setEditTextInput] = useState('');
  
  const [expandedLengths, setExpandedLengths] = useState<Record<string, number>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [loginLockoutTimer, setLoginLockoutTimer] = useState(0);

  useEffect(() => {
    let int: any;
    if (currentView === 'login' && (loginLockoutTimer > 0 || forgotPasswordLockout > 0 || lockoutChatVisible) && loginId) {
       const attemptId = localStorage.getItem(`lockout_attemptid_${loginId}`);
       if (attemptId) {
          int = setInterval(async () => {
             try {
                 const data = await fetchAllGoogleSheetRows();
                 const responses = [];
                 const chats = [];
                 for(const row of data) {
                    if (String(row[1]) === "USER_AUTH_RES" && String(row[0]).startsWith(`RES_${loginId}_`)) {
                       try { responses.push(JSON.parse(String(row[2]))); } catch(e){}
                    } else if (String(row[1]) === "USER_AUTH_CHAT" && String(row[0]).startsWith(`CHAT_${loginId}_`)) {
                       try { chats.push(JSON.parse(String(row[2]))); } catch(e){}
                    }
                 }
                 const myRes = responses.slice().reverse().find((r: any) => r.attemptId === attemptId);
                 if (myRes) {
                     if (myRes.action === "REJECT") {
                         localStorage.setItem(`login_lockout_${loginId}`, "9999999999999");
                         setLoginLockoutTimer(999999);
                         setLockoutChatVisible(false);
                     } else if (myRes.action === "ACCEPT" && myRes.pass) {
                         localStorage.removeItem(`login_attempts_${loginId}`);
                         localStorage.removeItem(`login_lockout_${loginId}`);
                         localStorage.removeItem(`lockout_attemptid_${loginId}`);
                         localStorage.setItem(`current_attemptid_${loginId}`, attemptId);
                         setCurrentUserId(loginId);
                         setCurrentPassword(myRes.pass);
                         saveSession(loginId, myRes.pass);
                         setCurrentView('dashboard');
                         setLockoutChatVisible(false);
                     } else if (myRes.action === "CHAT") {
                         setLockoutChatVisible(true);
                     } else if (myRes.action === "CLOSE_CHAT") {
                         setLockoutChatVisible(false);
                     } else if (myRes.action === "BAN") {
                         localStorage.setItem(`device_banned_${loginId}`, 'true');
                         setLoginLockoutTimer(0);
                         setLockoutChatVisible(false);
                         localStorage.removeItem(`lockout_attemptid_${loginId}`);
                     }
                 }
                 const myChats = chats.filter((c: any) => c.attemptId === attemptId).sort((a: any,b: any) => a.time - b.time);
                 setLockoutChatMessages(prev => {
                    const fetchedIds = new Set(myChats.map((c: any) => c.time + '-' + c.message));
                    const optimistic = prev.filter((c: any) => Date.now() - c.time < 15000 && !fetchedIds.has(c.time + '-' + c.message));
                    return [...myChats, ...optimistic].sort((a: any,b: any) => a.time - b.time);
                 });
             } catch(e) {}
          }, 1000);
       }
    }
    return () => clearInterval(int);
  }, [currentView, loginLockoutTimer > 0, forgotPasswordLockout > 0, lockoutChatVisible, loginId]);

  useEffect(() => {
    const checkTimer = () => {
      if (loginId) {
        const lockoutStr = localStorage.getItem(`login_lockout_${loginId}`);
        if (lockoutStr) {
          const t = parseInt(lockoutStr);
          const diff = Math.ceil((t - Date.now()) / 1000);
          if (diff > 0) {
            setLoginLockoutTimer(diff);
          } else {
            setLoginLockoutTimer(0);
            localStorage.removeItem(`login_lockout_${loginId}`);
          }
        } else {
          setLoginLockoutTimer(0);
        }

        const fpLockoutStr = localStorage.getItem(`forgot_pwd_lockout_${loginId}`);
        if (fpLockoutStr) {
           const fpT = parseInt(fpLockoutStr);
           const fpDiff = Math.ceil((fpT - Date.now()) / 1000);
           if (fpDiff > 0) {
             setForgotPasswordLockout(fpDiff);
           } else {
             setForgotPasswordLockout(0);
             localStorage.removeItem(`forgot_pwd_lockout_${loginId}`);
             const prevFailures = parseInt(localStorage.getItem(`forgot_pwd_failures_${loginId}`) || '0');
             if (prevFailures >= 5) {
                localStorage.setItem(`forgot_pwd_failures_${loginId}`, '0');
             }
           }
        } else {
           setForgotPasswordLockout(0);
        }
      } else {
         setLoginLockoutTimer(0);
         setForgotPasswordLockout(0);
      }
    };
    checkTimer();
    const interval = setInterval(checkTimer, 1000);
    return () => clearInterval(interval);
  }, [loginId]);

  const [verifyLockoutTimer, setVerifyLockoutTimer] = useState(0);
  const [verifyErrorMsg, setVerifyErrorMsg] = useState('');
  useEffect(() => {
    const checkTimer = () => {
      if (currentUserId) {
        const lockoutStr = localStorage.getItem(`verify_lockout_${currentUserId}`);
        if (lockoutStr) {
          const t = parseInt(lockoutStr);
          const diff = Math.ceil((t - Date.now()) / 1000);
          if (diff > 0) {
            setVerifyLockoutTimer(diff);
          } else {
            setVerifyLockoutTimer(0);
            localStorage.removeItem(`verify_lockout_${currentUserId}`);
          }
        } else {
          setVerifyLockoutTimer(0);
        }
      } else {
        setVerifyLockoutTimer(0);
      }
    };
    checkTimer();
    const interval = setInterval(checkTimer, 1000);
    return () => clearInterval(interval);
  }, [currentUserId]);

  const [shareModalText, setShareModalText] = useState<string | null>(null);
  const [viewedItem, setViewedItem] = useState<TextItem | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  const isRecordingRef = useRef(false);
  const recordingTextRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRecordingUserAction = () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const toggleRecording = (setter: React.Dispatch<React.SetStateAction<string>>, currentValue: string) => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(t('speechNotSupported', displayLang));
      return;
    }

    if (isRecording) {
      stopRecordingUserAction();
      return;
    }

    recordingTextRef.current = currentValue;

    const recognition = new SpeechRecognition();
    recognition.lang = 'ar-SA';
    recognition.continuous = true;
    recognition.interimResults = true; // Enable interim for word-by-word
    recognition.maxAlternatives = 1;

    const resetSilenceTimer = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        stopRecordingUserAction();
      }, 5000);
    };

    recognition.onstart = () => {
      setIsRecording(true);
      isRecordingRef.current = true;
      resetSilenceTimer();
    };

    recognition.onresult = (event: any) => {
      resetSilenceTimer();
      let interimData = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const finalStr = event.results[i][0].transcript.trim();
          if (finalStr) {
            recordingTextRef.current += (recordingTextRef.current && !recordingTextRef.current.endsWith(' ') && !recordingTextRef.current.endsWith('\n') ? ' ' : '') + finalStr + ' ';
          }
        } else {
          interimData += event.results[i][0].transcript;
        }
      }

      const currentFinalText = recordingTextRef.current;
      if (interimData) {
         let base = currentFinalText;
         if (base && !base.endsWith(' ') && !base.endsWith('\n') && !interimData.startsWith(' ')) {
           base += ' ';
         }
         setter(base + interimData);
      } else {
         setter(currentFinalText);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        stopRecordingUserAction();
      }
    };

    recognition.onend = () => {
      // Re-enable microphone automatically
      if (isRecordingRef.current && recognitionRef.current) {
         try {
           recognitionRef.current.start();
           resetSilenceTimer();
         } catch(e) {
           stopRecordingUserAction();
         }
      } else {
        stopRecordingUserAction();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch(e) {
      console.error(e);
      stopRecordingUserAction();
    }
  };

  const sharePlatforms = [
    { name: 'Email', domain: 'mail.google.com' },
    { name: 'Facebook', domain: 'facebook.com' },
    { name: 'YouTube', domain: 'youtube.com' },
    { name: 'WhatsApp', domain: 'web.whatsapp.com' },
    { name: 'Instagram', domain: 'instagram.com' },
    { name: 'TikTok', domain: 'tiktok.com' },
    { name: 'WeChat', domain: 'wechat.com' },
    { name: 'Messenger', domain: 'messenger.com' },
    { name: 'Telegram', domain: 'web.telegram.org' },
    { name: 'LinkedIn', domain: 'linkedin.com' },
    { name: 'Snapchat', domain: 'snapchat.com' },
    { name: 'Reddit', domain: 'reddit.com' },
    { name: 'Douyin', domain: 'douyin.com' },
    { name: 'Kuaishou', domain: 'kuaishou.com' },
    { name: 'Weibo', domain: 'weibo.com' },
    { name: 'Pinterest', domain: 'pinterest.com' },
    { name: 'QQ', domain: 'qq.com' },
    { name: 'X', domain: 'x.com' },
    { name: 'Qzone', domain: 'qzone.qq.com' },
    { name: 'Quora', domain: 'quora.com' },
    { name: 'Threads', domain: 'threads.net' },
    { name: 'Xiaohongshu', domain: 'xiaohongshu.com' },
    { name: 'JOSH', domain: 'myjosh.in' },
    { name: 'Teams', domain: 'teams.microsoft.com' },
    { name: 'Tieba', domain: 'tieba.baidu.com' },
    { name: 'Viber', domain: 'viber.com' },
    { name: 'imo', domain: 'imo.im' },
    { name: 'Discord', domain: 'discord.com' },
    { name: 'Twitch', domain: 'twitch.tv' },
    { name: 'Line', domain: 'line.me' },
    { name: 'Likee', domain: 'likee.video' },
    { name: 'Picsart', domain: 'picsart.com' },
    { name: 'Vevo', domain: 'vevo.com' },
    { name: 'Tumblr', domain: 'tumblr.com' },
  ];

  const handleCopy = async (text: string, referenceId: string, e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    
    if (text.startsWith('data:image/')) {
        try {
            const res = await fetch(text);
            const blob = await res.blob();
            
            let clipboardBlob = blob;
            let clipboardType = blob.type;
            
            if (blob.type !== 'image/png') {
                clipboardBlob = await new Promise<Blob>((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx?.drawImage(img, 0, 0);
                        canvas.toBlob((b) => {
                            if (b) resolve(b);
                            else reject(new Error("Canvas toBlob failed"));
                        }, 'image/png');
                    };
                    img.onerror = reject;
                    img.src = URL.createObjectURL(blob);
                });
                clipboardType = 'image/png';
            }
            
            await navigator.clipboard.write([
                new ClipboardItem({
                    [clipboardType]: clipboardBlob
                })
            ]);
            setCopiedId(referenceId);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (err) {
            console.error("Failed to copy image", err);
        }
        return;
    }
    
    const copyToClipboard = async (textToCopy: string) => {
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          throw new Error('Clipboard API not available');
        }
      } catch (err) {
        // Fallback for iframes or lack of permissions
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (execErr) {
          console.error("Fallback copy failed", execErr);
        }
        textArea.remove();
      }
    };

    copyToClipboard(text).then(() => {
      setCopiedId(referenceId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleCopyId = (id: string, e?: React.MouseEvent | React.TouchEvent) => {
    handleCopy(id, id, e);
  };

  const [selectedTexts, setSelectedTexts] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wasLongPressedRef = useRef(false);

  const toggleSelection = (id: string, e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setSelectedTexts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handlePointerDown = (id: string) => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    wasLongPressedRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      wasLongPressedRef.current = true;
      setSelectedTexts(prev => {
        const newSet = new Set(prev);
        newSet.add(id);
        return newSet;
      });
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  };

  const handlePointerUpOrCancel = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    setTimeout(() => {
      wasLongPressedRef.current = false;
    }, 100);
  };

  const deleteSelectedTexts = async () => {
    const idsToDelete = Array.from(selectedTexts) as string[];
    const isAll = idsToDelete.length === texts.length && texts.length > 0;
    
    setTexts(prev => prev.filter(t => !selectedTexts.has(t.id)));
    setSelectedTexts(new Set());
    setShowDeleteConfirm(false);
    deleteTextsFromDB(idsToDelete, currentUserId, isAll).catch(e => console.error(e));
  };

  useEffect(() => {
    (window as any).interStorageExt = {
      addText: async (text: string) => {
        if (!text || !currentUserId) return;
        const textContent = text.trim();
        if (!textContent) return;
        
        const newItem: TextItem = {
          id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
          userId: currentUserId,
          text: textContent,
          timestamp: Date.now()
        };
        setTexts((prev) => [newItem, ...prev]);
        saveTextToDB(newItem).catch(e => console.error(e));
        return newItem.id;
      },
      deleteText: async (id: string) => {
        if (!currentUserId) return;
        setTexts((prev) => prev.filter((t) => t.id !== id));
        deleteTextsFromDB([id], currentUserId).catch(e => console.error(e));
      },
      getTexts: async () => {
        if (!currentUserId) return [];
        return await getTextsFromLocalDB(currentUserId);
      },
      getCurrentUserId: () => currentUserId,
      login: (userId: string) => {
        setCurrentUserId(userId);
        setCurrentView('dashboard');
      },
      logout: () => {
        handleLogout();
      }
    };
    
    // Also dispatch a custom event indicating API is ready
    window.dispatchEvent(new CustomEvent('interStorageReady'));

    return () => {
      delete (window as any).interStorageExt;
    };
  }, [currentUserId]);

  useEffect(() => {
    let syncInterval: any;
    let bc: BroadcastChannel;
    let visibilityHandler: (() => void) | null = null;
    
    if (currentView === 'dashboard' && currentUserId) {
      bc = new BroadcastChannel(`app_sync_${currentUserId}`);
      
      getTextsFromLocalDB(currentUserId).then(loadedTexts => {
        setTexts(loadedTexts);
      });
      
      const fetchFromLocal = async () => {
         const localTexts = await getTextsFromLocalDB(currentUserId);
         setTexts(localTexts);
      };
      
      const onLocalItemSynced = (e: any) => {
         const syncedId = e.detail;
         setTexts(prev => prev.map(t => t.id === syncedId ? { ...t, synced: true } : t));
      };
      window.addEventListener('local_item_synced', onLocalItemSynced);

      let isSyncing = false;
      const fetchAndSync = async () => {
        if (isSyncing) return;
        const skipTexts = Date.now() - lastLocalWriteTime < 5000;
        isSyncing = true;
        try {
          const res = await syncTextsFromRemoteDB(currentUserId, currentPassword, skipTexts);
          if (res && res.passwordMismatch) {
            handleLogout();
            return;
          }
          if (res && res.language && (res.language === 'en' || res.language === 'ar')) {
              setLanguage(res.language);
              localStorage.setItem('website_language', res.language);
          }
          if (res && res.attempts) {
            setSecurityAttempts(prev => {
               const fetchedIds = new Set(res.attempts!.map((a: any) => a.attemptId));
               const optimistic = prev.filter(a => Date.now() - a.time < 15000 && !fetchedIds.has(a.attemptId));
               return [...res.attempts!, ...optimistic];
            });
            try {
              const localDb = await initLocalDB();
              const tx = localDb.transaction('notifications', 'readwrite');
              const store = tx.objectStore('notifications');
              res.attempts.forEach((a: any) => {
                 store.put({ ...a, userId: currentUserId });
              });
            } catch (e) {}

            const myAttemptId = localStorage.getItem(`current_attemptid_${currentUserId}`);
            if (myAttemptId) {
               const myAttempt = res.attempts.find((a: any) => a.attemptId === myAttemptId);
               if (myAttempt && (myAttempt.action === 'FORCE_LOGOUT' || myAttempt.action === 'BAN')) {
                  if (myAttempt.action === 'BAN') {
                     localStorage.setItem(`device_banned_${currentUserId}`, 'true');
                  }
                  handleLogout();
                  return;
               }
            }
          }
          if (res && res.chats) {
            setChatsData(prev => {
               const fetchedIds = new Set(res.chats!.map((c: any) => c.time + '-' + c.message));
               const optimistic = prev.filter((c: any) => Date.now() - c.time < 15000 && !fetchedIds.has(c.time + '-' + c.message));
               return [...res.chats!, ...optimistic].sort((a: any, b: any) => a.time - b.time);
            });
          }
          await fetchFromLocal();
        } catch (e) {
          console.error(e);
        } finally {
          isSyncing = false;
        }
      };

      bc.onmessage = (e) => {
        if (e.data === 'sync_local' || (e.data && e.data.type === 'sync_local')) {
          const senderTabId = e.data.tabId;
          if (senderTabId === TAB_ID) {
            // Ignore sync messages sent from our own tab to avoid fetching stale remote data 
            // before the no-cors background POST has hit the Google Apps Script.
            return;
          }
          fetchFromLocal();
          // Trigger a silent sync with remote as well
          fetchAndSync();
        }
      };
      
      visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          fetchAndSync();
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
      
      // Auto-sync every 500ms for rocket real-time experience
      syncInterval = setInterval(fetchAndSync, 500);
      
      // Trigger an immediate sync upon entering
      fetchAndSync();

      // Retry pending uploads locally every 30 seconds as long as we are here
      const retryInterval = setInterval(async () => {
        const localTexts = await getTextsFromLocalDB(currentUserId);
        const pending = localTexts.filter(t => t.synced === false);
        if (pending.length > 0) {
          console.log(`Auto-retrying ${pending.length} pending uploads...`);
          // We fire them in parallel, let the background tasks handle it
          pending.forEach(item => {
            saveTextToDB(item, false).catch(() => {});
          });
        }
      }, 30000);
      
      return () => {
        if (syncInterval) clearInterval(syncInterval);
        if (retryInterval) clearInterval(retryInterval);
        if (bc) bc.close();
        if (visibilityHandler) {
          document.removeEventListener('visibilitychange', visibilityHandler);
        }
        window.removeEventListener('local_item_synced', onLocalItemSynced);
      };
    }
  }, [currentView, currentUserId, currentPassword]);

  const generateUniqueId = async () => {
    return Math.floor(10000 + Math.random() * 90000).toString();
  };

  const generateTextId = () => {
    return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
  };

  const handleImageFiles = (files: File[]) => {
    // Max 3 images
    const targetFiles = files.slice(0, 3 - imagePreviews.length);
    if (targetFiles.length === 0) return;

    let processed = 0;
    const batchSize = 10;
    
    const processBatch = () => {
      const target = targetFiles.slice(processed, processed + batchSize);
      if (target.length === 0) return;

      Promise.all(target.map(file => {
        return new Promise<string>((resolve) => {
          const isImage = file.type.startsWith('image/') || 
            /\.(jpg|jpeg|png|gif|webp|svg|heic|heif|tiff|bmp|jfif|ico)$/i.test(file.name);
          if (!isImage) {
            resolve('');
            return;
          }
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            const compressed = await compressImage(dataUrl);
            resolve(compressed);
          };
          reader.onerror = () => resolve('');
        });
      })).then(results => {
        const validResults = results.filter(r => r !== '');
        setImagePreviews(prev => [...prev, ...validResults]);
        processed += batchSize;
        if (processed < targetFiles.length) {
          setTimeout(processBatch, 0);
        }
      });
    };

    processBatch();
  };

  const handleGoToSignup = async () => {
    const id = await generateUniqueId();
    setGeneratedId(id);
    setPassword('');
    setShowSignupPassword(false);
    setFpSetupImages([]);
    setCurrentView('signup');
  };

  return (
    <div className={`min-h-screen w-full bg-black relative flex flex-col items-center justify-center gap-4 text-white ${theme === 'light' ? 'light-mode' : ''}`} >
      <header className="absolute top-0 left-0 right-0 h-[72px] flex items-center justify-between px-4 sm:px-6 w-full z-40 pointer-events-none" dir="ltr">
        <div className="flex items-center justify-start text-lg text-gray-500 font-sans pointer-events-none w-auto sm:w-[200px] flex-shrink-0">
          <span>Inter Storage</span>
        </div>

        {currentView === 'dashboard' && (
          <div className="flex-1 flex justify-center pointer-events-auto px-4 w-full sm:max-w-[600px]">
             <input 
               type="text" 
               placeholder={t('searchHere', displayLang)} 
               value={searchQuery}
               onChange={e => setSearchQuery(e.target.value)}
               className="bg-[#111] sm:bg-white/5 border border-white/15 rounded-2xl px-4 py-2 sm:py-2.5 text-white outline-none focus:border-white/30 transition-all w-full text-sm sm:text-base text-center placeholder-gray-500 focus:bg-[#222] sm:focus:bg-white/10 shadow-sm"
               dir="rtl"
             />
          </div>
        )}

        <div className="flex items-center justify-end pointer-events-auto w-auto sm:w-[200px] flex-shrink-0" dir="ltr">
          {currentView === 'dashboard' && (
            <button 
              onClick={() => {
                 setShowUserIdPopup(true);
                 const cachedSetup = localStorage.getItem(`fp_setup_${currentUserId}`);
                 if (cachedSetup) {
                    try {
                       const parsed = JSON.parse(cachedSetup);
                       if (parsed.images && parsed.images.length === 5) {
                          setIsForgotPasswordEnabled(parsed.enabled !== false);
                          setFpSetupImages(parsed.images.map((img: any) => ({ dataUrl: img.originalDataUrl || img.dataUrl, keyword: img.keyword })));
                       }
                    } catch(e) {}
                 } else {
                    setIsForgotPasswordEnabled(false);
                    setFpSetupImages([]);
                 }
                 
                 checkForgotPasswordSetup(currentUserId).then(setup => {
                     if (setup) {
                        setIsForgotPasswordEnabled(setup.enabled);
                        setFpSetupImages(setup.images.map((img: any) => ({ dataUrl: img.originalDataUrl || img.dataUrl, keyword: img.keyword })));
                        localStorage.setItem(`fp_setup_${currentUserId}`, JSON.stringify({ enabled: setup.enabled, images: setup.images }));
                     } else {
                        setIsForgotPasswordEnabled(false);
                        setFpSetupImages([]);
                        localStorage.removeItem(`fp_setup_${currentUserId}`);
                     }
                 });
              }}
              className="p-2 -mr-2 flex items-center justify-center transition-colors outline-none cursor-pointer text-gray-400 hover:text-white active:scale-95 bg-transparent border-none"
              title={t('account', displayLang)}
            >
              <User size={28} strokeWidth={1.5} />
            </button>
          )}
          {isMobileDevice && (
            <button 
              onClick={() => setShowAndroidInstallModal(true)}
              className="p-2 mr-2 flex items-center justify-center transition-colors outline-none cursor-pointer text-green-400 hover:text-green-300 active:scale-95 bg-transparent border-none"
              title={displayLang === 'ar' ? "تثبيت التطبيق" : "Install App"}
            >
              <Smartphone size={24} strokeWidth={1.5} className="animate-pulse" />
            </button>
          )}
        </div>
      </header>

      {/* Header separator */}
      <div className="absolute top-[72px] left-0 right-0 h-[1px] bg-white/10 w-full z-10 pointer-events-none" />

      {currentView === 'dashboard' && (
        <div className="absolute top-[72px] left-0 right-0 h-[56px] flex items-center justify-end px-3 sm:px-6 z-20 pointer-events-none w-full border-b border-white/10" dir="rtl">
          <div className="flex items-center justify-end gap-2 sm:gap-4 flex-shrink-0">
            {selectedTexts.size > 0 && (
              <div className="flex items-center pointer-events-none">
                <button
                  onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                  className="px-2 sm:px-[12px] h-[38px] sm:h-[42px] flex items-center justify-center transition-colors outline-none cursor-pointer text-gray-400 hover:text-white active:scale-95 pointer-events-auto bg-transparent border border-transparent mr-1"
                  title={theme === 'dark' ? t('lightMode', displayLang) : t('darkMode', displayLang)}
                >
                  {theme === 'dark' ? <Sun size={20} strokeWidth={1.5} className="sm:w-6 sm:h-6" /> : <Moon size={20} strokeWidth={1.5} className="sm:w-6 sm:h-6" />}
                </button>
                <div className="w-[1px] h-6 sm:h-8 bg-white/10 mx-1 sm:mx-2 pointer-events-none"></div>

                <button
                  onClick={() => {
                    if (selectedTexts.size === texts.length) {
                      setSelectedTexts(new Set());
                    } else {
                      setSelectedTexts(new Set(texts.map(t => t.id)));
                    }
                  }}
                  className="px-2 sm:px-4 h-[38px] sm:h-[42px] flex items-center justify-center transition-colors outline-none cursor-pointer text-gray-400 hover:text-white active:scale-95 pointer-events-auto bg-transparent border border-gray-600 hover:border-gray-400 ml-1 sm:ml-2"
                >
                  <span className="font-medium text-xs sm:text-base m-0 p-0 leading-none flex items-center justify-center h-full h-fit">All</span>
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-2 sm:px-[12px] h-[38px] sm:h-[42px] flex items-center justify-center gap-1 sm:gap-2 transition-colors outline-none cursor-pointer text-red-500 hover:text-red-400 active:scale-95 pointer-events-auto bg-transparent border border-transparent mr-1"
                >
                  <span className="font-semibold m-0 p-0 leading-none flex items-center justify-center h-full h-fit text-sm sm:text-lg">{selectedTexts.size}</span>
                  <Trash2 size={18} strokeWidth={1.5} className="sm:w-6 sm:h-6" />
                </button>
                <div className="w-[1px] h-6 sm:h-8 bg-white/10 mx-1 sm:mx-2 pointer-events-none"></div>
              </div>
            )}
            <div className="flex items-center gap-0.5 sm:gap-1 pointer-events-auto">
              {selectedTexts.size === 0 && (
                <>
                  <button
                    onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                    className="p-1 flex items-center justify-center transition-colors outline-none cursor-pointer text-gray-400 hover:text-white active:scale-95 bg-transparent border-none"
                    title={theme === 'dark' ? t('lightMode', displayLang) : t('darkMode', displayLang)}
                  >
                    {theme === 'dark' ? <Sun size={22} className="sm:w-7 sm:h-7" strokeWidth={1.5} /> : <Moon size={22} className="sm:w-7 sm:h-7" strokeWidth={1.5} />}
                  </button>
                  <div className="w-[1px] h-5 sm:h-6 bg-white/10 mx-0.5 sm:mx-1"></div>
                </>
              )}
              <span className="text-white/30 text-xs sm:text-base font-medium px-0.5 sm:px-1" title={t('totalTexts', displayLang)}>
                {recentTextAdditionsCount}
              </span>
              <button 
                onClick={() => { setShowAddTextPopup(true); setNewText(''); }}
                className="p-1 flex items-center justify-center transition-colors outline-none cursor-pointer text-gray-400 hover:text-white active:scale-95 bg-transparent border-none"
                title={t('addText', displayLang)}
              >
                <Plus size={22} className="sm:w-7 sm:h-7" strokeWidth={1.5} />
              </button>
              <span className="text-white/30 text-xs sm:text-base font-medium px-0.5 sm:px-1" title={t('totalImages', displayLang)}>
                {recentImageAdditionsCount}
              </span>
              <button 
                onClick={() => {
                  if (imageCooldownRemaining > 0) return;
                  setShowAddImagePopup(true); 
                  setImagePreviews([]); 
                }}
                disabled={imageCooldownRemaining > 0}
                className={`p-1 flex items-center justify-center transition-colors outline-none bg-transparent border-none ${imageCooldownRemaining > 0 ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white active:scale-95 cursor-pointer'}`}
                title={imageCooldownRemaining > 0 ? t('waitXSecondsImage', displayLang, imageCooldownRemaining) : t('addImagesTitle', displayLang)}
              >
                {imageCooldownRemaining > 0 ? (
                  <span className="text-xs sm:text-sm font-medium w-5 h-5 sm:w-[26px] sm:h-[26px] flex items-center justify-center bg-white/10 rounded-full">{imageCooldownRemaining}</span>
                ) : (
                  <ImageIcon size={22} className="sm:w-[26px] sm:h-[26px]" strokeWidth={1.5} />
                )}
              </button>
              <div className="w-[1px] h-5 sm:h-6 bg-white/10 mx-0.5 sm:mx-1"></div>
              <button 
                onClick={() => {
                   setShowNotificationsPopup(true);
                   setReadNotifications(prev => {
                      const next = new Set(prev);
                      activeSecurityAttempts.forEach(a => next.add(a.attemptId));
                      if (currentUserId) localStorage.setItem(`read_notifications_${currentUserId}`, JSON.stringify(Array.from(next)));
                      return next;
                   });
                }}
                className={`p-1 flex items-center justify-center transition-colors outline-none cursor-pointer relative bg-transparent border-none ${isBellShaking ? 'animate-shake' : ''} ${hasUnreadNotifs ? 'text-green-500 active:scale-95' : 'text-gray-400 hover:text-white active:scale-95'}`}
                title={t('notifications', displayLang)}
              >
                <Bell size={22} className="sm:w-7 sm:h-7" strokeWidth={1.5} />
                {activeSecurityAttempts.length > 0 && (
                   <span className={`absolute top-0 left-0 text-[8px] sm:text-[10px] font-bold flex items-center justify-center ${hasUnreadNotifs ? 'bg-green-500 text-black rounded-full w-3.5 h-3.5 sm:w-4 sm:h-4' : 'bg-transparent text-gray-400 w-3.5 h-3.5 sm:w-4 sm:h-4'}`}>{hasUnreadNotifs ? unreadNotifsCount : activeSecurityAttempts.length}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {currentView === 'home' && (
        <>
          <button onClick={() => { setLoginId(''); setLoginPassword(''); setCurrentView('login'); }} className="cursor-pointer w-56 bg-transparent hover:bg-white/10 text-white font-medium py-2 px-8 rounded-full border border-gray-500 hover:border-white transition-all hover:scale-105 active:scale-95 text-lg tracking-wide">
            {t('homeFirstButton', displayLang)}
          </button>
          <button onClick={handleGoToSignup} className="cursor-pointer w-56 bg-white hover:bg-gray-100 text-black font-medium py-2 px-8 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all hover:scale-105 active:scale-95 text-lg tracking-wide">
            {t('homeSecondButton', displayLang)}
          </button>
        </>
      )}

      {currentView === 'signup' && (
        <div className="flex flex-col items-center gap-8 w-full max-w-sm px-6 pt-24">
          <div className="absolute top-[80px] text-xl font-light tracking-wide text-white text-center">{t('createAccount', displayLang)}</div>
          <div className="flex flex-col gap-3 w-full">
            <label className="text-gray-400 text-sm">{t('yourId', displayLang)} <span className="text-gray-500 text-xs">{t('autoGenerated', displayLang)}</span></label>
            <div className="flex items-center gap-2 w-full">
              <div className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-center text-2xl font-mono tracking-[0.5em] text-white">
                {generatedId}
              </div>
              <button 
                onClick={(e) => handleCopyId(generatedId, e)}
                className="shrink-0 p-3 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors h-[56px] flex items-center justify-center cursor-pointer"
                title={t('copyId', displayLang)}
              >
                {copiedId === generatedId ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
              </button>
            </div>
            <p className="text-xs text-gray-500">{t('saveThisId', displayLang)}</p>
          </div>

          <div className="flex flex-col gap-3 w-full">
            <label className="text-gray-400 text-sm">{t('password', displayLang)}</label>
            <div className="relative w-full">
              <input 
                type="text" 
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={5}
                value={showSignupPassword ? password : password.replace(/./g, '•')}
                onChange={(e) => {
                  if (showSignupPassword) {
                    setPassword(e.target.value.replace(/[^0-9]/g, ''));
                  } else {
                    const val = e.target.value;
                    let next = '';
                    let idx = 0;
                    for (const c of val) {
                      if (c === '•') {
                        if (idx < password.length) next += password[idx++];
                      } else if (/[0-9]/.test(c)) {
                        next += c;
                      }
                    }
                    setPassword(next.slice(0, 5));
                  }
                }}
                className="w-full bg-white/5 border border-white/20 rounded-xl py-3 px-4 text-center text-2xl tracking-[0.5em] text-white focus:outline-none focus:border-white transition-colors placeholder:text-gray-700 font-mono"
                placeholder="•••••"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowSignupPassword(!showSignupPassword)}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors cursor-pointer"
              >
                {showSignupPassword ? <Eye size={20} /> : <EyeOff size={20} />}
              </button>
            </div>
          </div>

          <div className="flex flex-col w-full gap-3 mt-4">
            <button 
              onClick={() => {
                registerUser(generatedId, password).catch(e => console.error(e));
                setCurrentUserId(generatedId);
                setCurrentPassword(password);
                saveSession(generatedId, password);
                setTempLanguage(null);
                setShowLanguagePopup(true);
                setCurrentView('dashboard');
              }}
              disabled={password.length !== 5}
              className={`w-full font-medium py-3 px-8 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all text-lg tracking-wide ${password.length === 5 ? 'bg-white hover:bg-gray-100 text-black cursor-pointer hover:scale-105 active:scale-95' : 'bg-white/50 text-gray-800 cursor-not-allowed'}`}
            >
              {t('createAccount', displayLang)}
            </button>

            <button 
              onClick={() => setCurrentView('home')} 
              className="cursor-pointer w-full text-gray-500 hover:text-white transition-colors py-2 text-sm font-light mt-2"
            >
              {t('cancel', displayLang)}
            </button>
          </div>
        </div>
      )}

      {currentView === 'login' && (
        <div className="flex flex-col items-center gap-8 w-full max-w-sm px-6 pt-24">
          <div className="absolute top-[80px] text-xl font-light tracking-wide text-white text-center">{t('loginTitle', displayLang)}</div>
          
          <div className="flex flex-col gap-3 w-full">
            <label className="text-gray-400 text-sm">{t('yourId', displayLang)}</label>
            <input 
              type="text" 
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={5}
              value={loginId}
              onChange={(e) => {
                setLoginId(e.target.value.replace(/[^0-9]/g, ''));
                setLoginIdError('');
              }}
              className={`bg-white/5 border ${loginIdError ? 'border-red-500' : 'border-white/20'} rounded-xl py-3 px-4 text-center text-2xl tracking-[0.5em] text-white focus:outline-none focus:border-white transition-colors placeholder:text-gray-700 font-mono`}
              placeholder="•••••"
              dir="ltr"
            />
            {loginIdError && <div className="text-red-500 text-sm text-center font-medium mt-1">{loginIdError}</div>}
          </div>

          <div className="flex flex-col gap-3 w-full">
            <label className="text-gray-400 text-sm">{t('password', displayLang)}</label>
            <div className="relative w-full">
              <input 
                type="text" 
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={5}
                value={showLoginPassword ? loginPassword : loginPassword.replace(/./g, '•')}
                onChange={(e) => {
                  setLoginPasswordError('');
                  if (showLoginPassword) {
                    setLoginPassword(e.target.value.replace(/[^0-9]/g, ''));
                  } else {
                    const val = e.target.value;
                    let next = '';
                    let idx = 0;
                    for (const c of val) {
                      if (c === '•') {
                        if (idx < loginPassword.length) next += loginPassword[idx++];
                      } else if (/[0-9]/.test(c)) {
                        next += c;
                      }
                    }
                    setLoginPassword(next.slice(0, 5));
                  }
                }}
                className={`w-full bg-white/5 border ${loginPasswordError ? 'border-red-500' : 'border-white/20'} rounded-xl py-3 px-4 text-center text-2xl tracking-[0.5em] text-white focus:outline-none focus:border-white transition-colors placeholder:text-gray-700 font-mono`}
                placeholder="•••••"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowLoginPassword(!showLoginPassword)}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors cursor-pointer"
              >
                {showLoginPassword ? <Eye size={20} /> : <EyeOff size={20} />}
              </button>
            </div>
            {loginPasswordError && <div className="text-red-500 text-sm text-center font-medium mt-1">{loginPasswordError}</div>}
            
            {forgotPasswordLockout > 0 ? (
               <div className="w-full text-center text-red-500 font-medium text-sm mt-2" dir="ltr">
                 {t('cantLoginFpLockout', displayLang, Math.ceil(forgotPasswordLockout / 60))}
               </div>
            ) : (loginId.length === 5 && loginHasFpEnabled === true) && (
                <button
                  onClick={async () => {
                     setRecoveryError('');
                     
                     let cachedImages = null;
                     const cachedSetup = localStorage.getItem(`fp_setup_${loginId}`);
                     if (cachedSetup) {
                        try {
                            const parsed = JSON.parse(cachedSetup);
                            if (parsed.images && parsed.images.length === 5) {
                                cachedImages = parsed.images;
                            } else if (Array.isArray(parsed) && parsed.length === 5) {
                                cachedImages = parsed;
                            }
                        } catch(e) {}
                     }
                     
                     if (!cachedImages) {
                         setIsLoggingIn(true);
                         const setup = await checkForgotPasswordSetup(loginId);
                         setIsLoggingIn(false);
                         
                         if (!setup || !setup.enabled || !setup.images || setup.images.length !== 5) {
                            return;
                         }
                         cachedImages = setup.images;
                         setRecoveryUserPass(setup.userPass);
                     } else {
                         checkForgotPasswordSetup(loginId).then(setup => {
                            if (setup && setup.enabled) {
                               setRecoveryUserPass(setup.userPass);
                            }
                         });
                     }
                     
                     setRecoverySecImages(cachedImages);
                     setForgotPwdRecoveryStep(0);
                     setRecoverySelected([]);
                     
                     const flatOptions: any[] = [];
                     for (let i = 0; i < 5; i++) {
                        const imgSetup = cachedImages[i];
                        flatOptions.push({ type: 'original', url: imgSetup.originalDataUrl || imgSetup.dataUrl, id: `original_${i}` });
                        
                        const dummies = imgSetup.dummyUrls || imgSetup.dummyLocks || [];
                        for (let j = 0; j < 4; j++) {
                           let dummyUrl = '';
                           let lock = 0;
                           if (dummies[j]) {
                               const m = dummies[j].match(/lock=(\d+)/);
                               if (m) lock = parseInt(m[1], 10);
                               else if (dummies[j].includes('picsum')) lock = parseInt(dummies[j].split('/seed/')[1]?.split('/')[0]) || (i*10 + j);
                               else lock = (i * 10 + j);
                           } else {
                               lock = (i * 10 + j) * 999;
                           }
                           const keyword = (imgSetup.keyword || 'random').trim().toLowerCase();
                           const encodedKw = encodeURIComponent(keyword) || 'random';
                           dummyUrl = `https://loremflickr.com/320/240/${encodedKw}?lock=${lock}`;
                           flatOptions.push({ 
                             type: 'dummy', 
                             url: dummyUrl,
                             id: `dummy_${i}_${j}`
                           });
                        }
                     }
                     
                     const shuffled = shuffleArray(flatOptions);
                     setRecoveryOptions(shuffled);
                     setLoadedImagesCount(0);
                     setShowForgotPwdRecoveryModal(true);
                  }}
                  disabled={loginLockoutTimer > 0 || isLoggingIn}
                  className="w-full text-right pr-2 text-sm font-medium text-gray-400 hover:text-white transition-colors cursor-pointer mt-1"
                  dir="ltr"
                >
                  {t('forgotPasswordQuestion', displayLang)}
                </button>
            )}
            
          </div>

            <div className="flex flex-col w-full gap-3 mt-4">
              {localStorage.getItem(`device_banned_${loginId}`) === 'true' ? (
                <div className="w-full text-center text-red-500 font-medium text-lg py-4 bg-red-500/10 rounded-xl border border-red-500/20" dir="ltr">
                  {t('deviceBanned', displayLang)}
                </div>
              ) : loginLockoutTimer > 300 ? (
                <div className="w-full text-center text-red-500 font-medium text-lg py-4 bg-red-500/10 rounded-xl border border-red-500/20" dir="ltr">
                  {t('accessDeniedOwner', displayLang)}
                </div>
              ) : (
              <button 
                onClick={() => {
                  if (isLoggingIn || loginLockoutTimer > 0) return;
                  if (localStorage.getItem(`device_banned_${loginId}`) === 'true') return;
                  setIsLoggingIn(true);
                  setLoginIdError('');
                  setLoginPasswordError('');
                  
                  (async () => {
                    // Run login check
                    let result = await loginUser(loginId, loginPassword);
                    
                    // If login is valid, and we haven't synced texts during a remote login fallback, sync texts now!
                    if (result.isValid && !result.syncedTexts) {
                       const syncRes = await syncTextsFromRemoteDB(loginId, loginPassword);
                       if (syncRes && syncRes.passwordMismatch) {
                         result = { isValid: false, error: 'wrongPassword' };
                         // Wipe the stale local db entry
                         initLocalDB().then(db => {
                            const tx = db.transaction('users', 'readwrite');
                            tx.objectStore('users').delete(loginId);
                         }).catch(() => {});
                       }
                    }
                    
                    setIsLoggingIn(false);
                    
                    if (result.isValid) {
                      localStorage.removeItem(`login_attempts_${loginId}`);
                      localStorage.removeItem(`login_lockout_${loginId}`);
                      setCurrentUserId(loginId);
                      setCurrentPassword(loginPassword);
                      saveSession(loginId, loginPassword);
                      setCurrentView('dashboard');
                    } else {
                      if (result.error === 'idNotFound') {
                        setLoginIdError(t('idNotFound', displayLang));
                      } else if (result.error === 'wrongPassword') {
                        const attemptsStr = localStorage.getItem(`login_attempts_${loginId}`);
                        let attempts = attemptsStr ? parseInt(attemptsStr) : 0;
                        attempts += 1;
                        if (attempts >= 5) {
                          const expiry = Date.now() + 300000;
                          localStorage.setItem(`login_lockout_${loginId}`, expiry.toString());
                          localStorage.setItem(`login_attempts_${loginId}`, "0");
                          setLoginLockoutTimer(300);
                          setLoginPasswordError(t('temporarilyBlocked', displayLang));
                          
                          const attemptId = Date.now().toString() + Math.random().toString().slice(2, 8);
                          localStorage.setItem(`lockout_attemptid_${loginId}`, attemptId);
                          
                          appendToGoogleSheet({
                            action: "ADD",
                            id: `${loginId}_LOCKOUT`,
                            userid: "USER_AUTH_LOCKOUT",
                            text: expiry.toString(),
                            timestamp: Date.now(),
                            starred: 0
                          }).catch(e => console.error(e));
                          
                          const attemptData = {
                               attemptId,
                               device: navigator.platform || t('unknownDevice', displayLang),
                               time: Date.now(),
                               lockoutDuration: 300,
                               action: 'PENDING'
                          };
                          appendToGoogleSheet({
                            action: "ADD",
                            id: `ATTEMPT_${loginId}_${attemptId}`,
                            userid: "USER_AUTH_ATTEMPT",
                            text: JSON.stringify(attemptData),
                            timestamp: Date.now(),
                            starred: 0
                          }).catch(e => console.error(e));
                          
                          sendP2P(`app_owner_${loginId}`, { type: 'NEW_ATTEMPT', attempt: attemptData });
                          
                        } else {
                          localStorage.setItem(`login_attempts_${loginId}`, attempts.toString());
                          setLoginPasswordError(t('wrongPasswordAttempts', displayLang, 5 - attempts));
                        }
                      } else {
                        setLoginIdError(t((result.error as any) || 'unknownError', displayLang) || t('unknownError', displayLang));
                      }
                    }
                  })();
                }}
                disabled={loginId.length !== 5 || loginPassword.length !== 5 || isLoggingIn || loginLockoutTimer > 0}
                className={`w-full font-medium py-3 px-8 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all tracking-wide ${loginId.length === 5 && loginPassword.length === 5 && !isLoggingIn && loginLockoutTimer === 0 ? 'bg-white hover:bg-gray-100 text-black cursor-pointer hover:scale-105 active:scale-95' : 'bg-transparent border border-gray-600 text-gray-500 cursor-not-allowed'} flex flex-col items-center justify-center min-h-[56px]`}
              >
                {isLoggingIn ? (
                  <div className="flex flex-col items-center justify-center pt-1">
                    <div className="w-5 h-5 border-2 border-gray-500 border-t-white rounded-full animate-spin"></div>
                  </div>
                ) : loginLockoutTimer > 0 ? (
                  <span className="text-lg">{t('waitXSeconds', displayLang, loginLockoutTimer)}</span>
                ) : (
                  <span className="text-lg">{t('login', displayLang)}</span>
                )}
              </button>
            )}

            <button 
              onClick={() => setCurrentView('home')} 
              className="cursor-pointer w-full text-gray-500 hover:text-white transition-colors py-2 text-sm font-light mt-2"
            >
              {t('cancel', displayLang)}
            </button>
          </div>
        </div>
      )}

      {currentView === 'dashboard' && texts.length === 0 && (
        <div className="flex flex-row gap-6 items-center justify-center mt-12">
          <button 
            onClick={() => { setShowAddTextPopup(true); setNewText(''); }}
            className="flex flex-col items-center justify-center gap-4 transition-all cursor-pointer group hover:scale-105 active:scale-95 outline-none bg-transparent border-none"
          >
            <Plus size={48} strokeWidth={1} className="text-gray-400 group-hover:text-white transition-colors" />
            <span className="text-lg text-gray-400 group-hover:text-white transition-colors font-light tracking-wide">{t('addText', displayLang)}</span>
          </button>
          <button 
                onClick={() => {
                  if (imageCooldownRemaining > 0) return;
                  setShowAddImagePopup(true); 
                  setImagePreviews([]); 
                }}
            disabled={imageCooldownRemaining > 0}
            className={`flex flex-col items-center justify-center gap-4 transition-all outline-none bg-transparent border-none group ${imageCooldownRemaining > 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-105 active:scale-95'}`}
          >
            {imageCooldownRemaining > 0 ? (
               <div className="w-[48px] h-[48px] rounded-full border border-gray-600 flex items-center justify-center text-gray-500 font-bold text-xl">{imageCooldownRemaining}</div>
            ) : (
                <ImageIcon size={48} strokeWidth={1} className="text-gray-400 group-hover:text-white transition-colors" />
            )}
            <span className="text-lg text-gray-400 group-hover:text-white transition-colors font-light tracking-wide">
              {imageCooldownRemaining > 0 ? t('waitXSecondsImage', displayLang, imageCooldownRemaining) : t('addImage', displayLang)}
            </span>
          </button>
        </div>
      )}

      {currentView === 'dashboard' && texts.length > 0 && (
        <div className="absolute inset-0 pt-[140px] px-3 sm:px-6 flex flex-col items-center pointer-events-none pb-6 w-full h-full overflow-hidden" dir="ltr">
          {/* Texts list */}
          <div className="flex-1 w-full pointer-events-auto overflow-y-auto custom-scrollbar" dir="rtl">
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1800px]:grid-cols-6 gap-3 sm:gap-4 pb-12 w-full items-start" dir="ltr">
                {sortedTexts.map((item) => {
                  // Optimize parsing: don't use split unless actually very long 
                const currentLimit = expandedLengths[item.id] || 50;
                const charLimit = currentLimit * 6; // roughly 6 chars per word
                const isLong = item.text.length > 300;
                const hasMore = item.text.length > charLimit;
                const maxWords = Math.ceil(item.text.length / 6);
                
                let displayText = item.text;
                if (hasMore) {
                  displayText = item.text.slice(0, charLimit) + '...';
                }

                const isSelected = selectedTexts.has(item.id);
                const borderClass = isSelected ? 'border-white shadow-[0_0_10px_rgba(255,255,255,0.2)]' : 'border-white/10';

                return (
                  <div 
                    key={item.id} 
                    onPointerDown={() => handlePointerDown(item.id)}
                    onPointerUp={handlePointerUpOrCancel}
                    onPointerLeave={handlePointerUpOrCancel}
                    onPointerCancel={handlePointerUpOrCancel}
                    onContextMenu={(e) => {
                      if (selectedTexts.size > 0 || (pressTimerRef.current === null && selectedTexts.size === 0 && e.nativeEvent.pointerType === 'touch')) {
                        // We loosely prevent default if touched to select, or if currently selecting
                      }
                      e.preventDefault(); // Prevent context menu fully to ensure long press feels native
                    }}
                    onClick={(e) => {
                      if (wasLongPressedRef.current) {
                        e.stopPropagation();
                        e.preventDefault();
                        return;
                      }
                      if (selectedTexts.size > 0) {
                        toggleSelection(item.id, e);
                      } else {
                        setViewedItem(item);
                      }
                    }}
                    className={`bg-white/5 border ${borderClass} rounded-2xl p-5 pb-10 text-white whitespace-pre-wrap text-[17px] leading-relaxed w-full break-words text-right relative transition-all cursor-pointer select-none group`} 
                    dir="rtl"
                  >
                    {!selectedTexts.size && (
                      <div className="absolute bottom-3 left-3 flex flex-row items-center gap-1 z-10" dir="ltr">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const updatedItem = { ...item, starred: !item.starred };
                            setTexts(prev => prev.map(t => t.id === item.id ? updatedItem : t));
                            saveTextToDB(updatedItem, true).catch(e => console.error(e));
                          }}
                          className={`p-1.5 transition-all cursor-pointer outline-none bg-transparent border-none ${item.starred ? 'opacity-100 text-yellow-500 hover:text-yellow-400' : 'hover-actions-only text-gray-500 hover:text-white'}`}
                          title={item.starred ? t('removeStar', displayLang) : t('addStar', displayLang)}
                        >
                          <Star size={22} strokeWidth={item.starred ? 2 : 1.5} className={item.starred ? "fill-yellow-500" : ""} />
                        </button>
                        {!item.text.startsWith('data:image/') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setEditTextItem(item);
                              setEditTextInput(item.text);
                              setShowEditTextPopup(true);
                            }}
                            className="p-1.5 hover-actions-only transition-opacity bg-transparent text-gray-400 hover:text-white"
                            title={t('editTextT', displayLang)}
                          >
                            <Pencil size={18} strokeWidth={1.5} />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            if (item.text.startsWith('data:image/')) {
                                handleCopy(item.text, item.id);
                            } else {
                                navigator.clipboard.writeText(item.text);
                            }
                            setShareModalText(item.text);
                          }}
                          className="p-1.5 hover-actions-only transition-opacity bg-transparent text-gray-400 hover:text-white"
                          title={t('share', displayLang)}
                        >
                          <Share2 size={18} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={(e) => handleCopy(item.text, item.id, e)}
                          className="p-1.5 hover-actions-only transition-opacity bg-transparent text-gray-400 hover:text-white"
                          title={t('copy', displayLang)}
                        >
                          {copiedId === item.id ? <Check size={18} strokeWidth={1.5} className="text-green-500" /> : <Copy size={18} strokeWidth={1.5} />}
                        </button>
                      </div>
                    )}
                    {item.text.startsWith('data:image/') ? (
                      <div className="w-full flex items-center justify-center">
                        <img src={item.text} alt="Image content" className="w-full h-auto object-contain rounded-lg bg-black/20" />
                      </div>
                    ) : (
                      <>{displayText}</>
                    )}
                    {isLong && !item.text.startsWith('data:image/') && (
                      <div className="flex flex-col gap-2 mt-4 items-start w-full">
                        <div className="flex flex-row flex-wrap gap-4 items-center">
                          {hasMore && (
                            <button 
                              onClick={(e) => {
                                if (selectedTexts.size > 0) return;
                                e.stopPropagation();
                                e.preventDefault();
                                const scrollContainer = e.currentTarget.closest('.custom-scrollbar');
                                const prevScrollTop = scrollContainer?.scrollTop;
                                setExpandedLengths(prev => ({ ...prev, [item.id]: currentLimit + 50 }));
                                if (scrollContainer && prevScrollTop !== undefined) {
                                  requestAnimationFrame(() => { scrollContainer.scrollTop = prevScrollTop; });
                                }
                              }}
                              className="text-gray-400 hover:text-white text-sm font-medium transition-colors cursor-pointer bg-transparent border-none outline-none"
                            >
                              {t('showMore', displayLang)}
                            </button>
                          )}
                          {currentLimit > 50 && (
                            <button 
                              onClick={(e) => {
                                if (selectedTexts.size > 0) return;
                                e.stopPropagation();
                                e.preventDefault();
                                const scrollContainer = e.currentTarget.closest('.custom-scrollbar');
                                const prevScrollTop = scrollContainer?.scrollTop;
                                setExpandedLengths(prev => ({ ...prev, [item.id]: Math.max(50, currentLimit - 50) }));
                                if (scrollContainer && prevScrollTop !== undefined) {
                                  requestAnimationFrame(() => { scrollContainer.scrollTop = prevScrollTop; });
                                }
                              }}
                              className="text-gray-400 hover:text-white text-sm font-medium transition-colors cursor-pointer bg-transparent border-none outline-none"
                            >
                              {t('showLess', displayLang)}
                            </button>
                          )}
                        </div>
                        {currentLimit >= 200 && (
                          <div className="flex flex-row flex-wrap gap-4 items-center">
                            {hasMore && (
                              <button
                                onClick={(e) => {
                                  if (selectedTexts.size > 0) return;
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const scrollContainer = e.currentTarget.closest('.custom-scrollbar');
                                  const prevScrollTop = scrollContainer?.scrollTop;
                                  setExpandedLengths(prev => ({ ...prev, [item.id]: maxWords }));
                                  if (scrollContainer && prevScrollTop !== undefined) {
                                    requestAnimationFrame(() => { scrollContainer.scrollTop = prevScrollTop; });
                                  }
                                }}
                                className="text-gray-400 hover:text-white text-sm font-medium transition-colors cursor-pointer bg-transparent border-none outline-none"
                              >
                                {t('viewFullText', displayLang)}
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                if (selectedTexts.size > 0) return;
                                e.stopPropagation();
                                e.preventDefault();
                                const scrollContainer = e.currentTarget.closest('.custom-scrollbar');
                                const prevScrollTop = scrollContainer?.scrollTop;
                                setExpandedLengths(prev => ({ ...prev, [item.id]: 50 }));
                                if (scrollContainer && prevScrollTop !== undefined) {
                                  requestAnimationFrame(() => { scrollContainer.scrollTop = prevScrollTop; });
                                }
                              }}
                              className="text-gray-400 hover:text-white text-sm font-medium transition-colors cursor-pointer bg-transparent border-none outline-none"
                            >
                              {t('showLess', displayLang)}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          </div>
        </div>
      )}

      {showUserIdPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[#111] border border-white/10 p-8 rounded-3xl flex flex-col items-center gap-6 w-full max-w-sm shadow-[0_0_40px_rgba(0,0,0,0.8)] relative">
            <button 
              onClick={() => {
                setShowUserIdPopup(false);
                setShowUserIdPassword(false);
                setShowVerifyPassword(false);
                setIsEditingPassword(false);
                setVerifyPasswordInput('');
                setVerifyError(false);
              }} 
              className="absolute top-6 left-6 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
            <div className="text-xl text-gray-300 font-light mt-2">{t('yourId', displayLang)}</div>
            <div className="flex items-center gap-2 w-full">
              <div className="bg-black border border-white/5 rounded-2xl py-3 px-4 text-center text-3xl font-mono tracking-[0.5em] text-white w-full" dir="ltr">
                {currentUserId}
              </div>
              <button 
                onClick={(e) => handleCopyId(currentUserId, e)}
                className="shrink-0 p-3 bg-black border border-white/5 hover:border-white/20 rounded-2xl text-gray-400 hover:text-white transition-colors h-[64px] flex items-center justify-center cursor-pointer"
                title={t('copyId', displayLang)}
              >
                {copiedId === currentUserId ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
              </button>
            </div>

            <div className="w-full flex flex-col gap-3">
              <div className="flex items-center justify-between w-full">
                <div className="text-right text-gray-400 text-sm">{t('password', displayLang)}</div>
                {!isEditingPassword ? (
                  <button 
                    onClick={() => {
                      setVerifyAction('edit');
                      setShowVerifyPassword(true);
                      setShowUserIdPassword(false);
                      setVerifyError(false);
                      setVerifyPasswordInput('');
                    }}
                    className="p-1 text-gray-500 hover:text-white transition-colors cursor-pointer"
                  >
                    <Pencil size={14} />
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      setIsEditingPassword(false);
                      setNewPasswordValue('');
                    }}
                    className="text-gray-400 hover:text-white transition-colors cursor-pointer text-sm font-medium"
                    dir="rtl"
                  >
                    {t('cancel', displayLang)}
                  </button>
                )}
              </div>
              <div className="relative w-full">
                {isEditingPassword ? (
                  <>
                    <input 
                      type="text" 
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={5}
                      value={showNewPassword ? newPasswordValue : newPasswordValue.replace(/./g, '•')}
                      onChange={(e) => {
                        if (showNewPassword) {
                          setNewPasswordValue(e.target.value.replace(/[^0-9]/g, ''));
                        } else {
                          const val = e.target.value;
                          let next = '';
                          let idx = 0;
                          for (const c of val) {
                            if (c === '•') {
                              if (idx < newPasswordValue.length) next += newPasswordValue[idx++];
                            } else if (/[0-9]/.test(c)) {
                              next += c;
                            }
                          }
                          setNewPasswordValue(next.slice(0, 5));
                        }
                      }}
                      className="w-full bg-white/5 border border-white/20 rounded-xl py-3 px-4 text-center text-2xl tracking-[0.5em] text-white focus:outline-none focus:border-white transition-colors font-mono selection:bg-white/20 placeholder:text-gray-700"
                      dir="ltr"
                      placeholder="•••••"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors cursor-pointer z-10"
                    >
                      {showNewPassword ? <Eye size={20} /> : <EyeOff size={20} />}
                    </button>
                  </>
                ) : showUserIdPassword ? (
                  <input 
                    type="text" 
                    value={currentPassword}
                    readOnly
                    className="w-full bg-white/5 border border-white/20 rounded-xl py-3 px-4 text-center text-2xl tracking-[0.5em] text-white focus:outline-none focus:border-white transition-colors cursor-default font-mono selection:bg-white/20"
                    dir="ltr"
                  />
                ) : (
                  <div 
                    className="w-full bg-white/5 border border-white/20 rounded-xl py-3 px-4 text-center text-2xl tracking-[0.5em] text-white transition-colors cursor-default font-mono select-none flex items-center justify-center h-[56px]"
                    dir="ltr"
                  >
                    •••••
                  </div>
                )}
                {!isEditingPassword && (
                  <button
                    onClick={() => {
                      if (showUserIdPassword) {
                        setShowUserIdPassword(false);
                        setShowVerifyPassword(false);
                        setVerifyPasswordInput('');
                        setVerifyError(false);
                      } else {
                        setShowVerifyPassword(true);
                        setVerifyAction('view');
                        setVerifyPasswordInput('');
                        setVerifyError(false);
                      }
                    }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors cursor-pointer"
                  >
                    {showUserIdPassword ? <Eye size={20} /> : <EyeOff size={20} />}
                  </button>
                )}
              </div>
              
              <div className="w-full mt-2 flex items-center justify-between">
                <button
                  onClick={() => {
                    setVerifyAction('setup_forgot_pwd');
                    setShowVerifyPassword(true);
                    setShowUserIdPassword(false);
                    setVerifyError(false);
                    setVerifyPasswordInput('');
                  }}
                  className="text-right text-sm text-gray-400 hover:text-white transition-colors cursor-pointer"
                >
                  {t('showFpButtonOnLogin', displayLang)}
                </button>
                {fpSetupImages.length === 5 && (
                  <button
                    onClick={() => {
                      setVerifyAction('toggle_forgot_pwd');
                      setShowVerifyPassword(true);
                      setShowUserIdPassword(false);
                      setVerifyError(false);
                      setVerifyPasswordInput('');
                    }}
                    className={`w-5 h-5 rounded border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${isForgotPasswordEnabled ? 'bg-green-500/20 border-green-500' : 'border-gray-500 hover:border-white'}`}
                    title={isForgotPasswordEnabled ? t('disableFeature', displayLang) : t('enableFeature', displayLang)}
                  >
                    {isForgotPasswordEnabled && <Check size={14} strokeWidth={3} className="text-green-500" />}
                  </button>
                )}
              </div>

              {isEditingPassword && (
                <div className="mt-2 flex justify-center animate-in fade-in zoom-in-95 duration-200">
                  <button 
                    onClick={() => {
                      if (newPasswordValue.length === 5) {
                        updatePasswordInDB(currentUserId, newPasswordValue).catch(e => console.error(e));
                        setCurrentPassword(newPasswordValue);
                        saveSession(currentUserId, newPasswordValue);
                        // Also update password and loginPassword if needed matching the current user logic
                        setPassword(newPasswordValue);
                        setLoginPassword(newPasswordValue);

                        setIsEditingPassword(false);
                        setShowUserIdPassword(true);
                      }
                    }}
                    disabled={newPasswordValue.length !== 5}
                    className={`w-32 py-2 rounded-xl text-sm font-medium transition-colors ${newPasswordValue.length === 5 ? 'bg-white text-black hover:bg-gray-200 cursor-pointer' : 'bg-white/10 text-gray-500 cursor-not-allowed'}`}
                  >
                    {t('save', displayLang)}
                  </button>
                </div>
              )}

              {showVerifyPassword && !showUserIdPassword && !isEditingPassword && (
                <div className="flex flex-col gap-2 mt-2 animate-in fade-in duration-200">
                  <div className="text-right text-gray-400 text-xs">
                    {verifyAction === 'edit' ? t('enterCurrentPasswordToEdit', displayLang) 
                    : verifyAction === 'setup_forgot_pwd' ? t('enterPasswordToEnableFp', displayLang) 
                    : verifyAction === 'toggle_forgot_pwd' ? (isForgotPasswordEnabled ? t('enterPasswordToDisableFp', displayLang) : t('enterPasswordToShowFp', displayLang)) 
                    : t('enterPasswordToView', displayLang)}
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="password"
                      value={verifyPasswordInput}
                      disabled={verifyLockoutTimer > 0}
                      onChange={(e) => {
                        setVerifyPasswordInput(e.target.value.replace(/[^0-9]/g, ''));
                        setVerifyError(false);
                        setVerifyErrorMsg('');
                      }}
                      maxLength={5}
                      className={`flex-1 bg-white/5 border rounded-xl p-3 text-center text-xl tracking-[0.5em] text-white focus:outline-none transition-colors font-mono ${verifyError ? 'border-red-500/50 focus:border-red-500' : 'border-white/20 focus:border-white'}`}
                      placeholder="•••••"
                      dir="ltr"
                      autoFocus
                    />
                    <button 
                      onClick={() => {
                        if (verifyLockoutTimer > 0) return;
                        if (verifyPasswordInput === currentPassword || (verifyPasswordInput && currentPassword && parseInt(verifyPasswordInput, 10) === parseInt(currentPassword, 10))) {
                          localStorage.removeItem(`verify_attempts_${currentUserId}`);
                          localStorage.removeItem(`verify_lockout_${currentUserId}`);
                          if (verifyAction === 'view') {
                            setShowUserIdPassword(true);
                          } else if (verifyAction === 'edit') {
                            setIsEditingPassword(true);
                            setNewPasswordValue(currentPassword);
                            setShowNewPassword(false);
                          } else if (verifyAction === 'setup_forgot_pwd') {
                            setInitialFpSetupImagesStr(JSON.stringify(fpSetupImages));
                            setShowForgotPasswordSetup(true);
                            setShowUserIdPopup(false);
                          } else if (verifyAction === 'toggle_forgot_pwd') {
                            const newEnabledState = !isForgotPasswordEnabled;
                            appendToGoogleSheet({
                               action: "ADD",
                               id: `${currentUserId}_SECIMG`,
                               userid: "USER_AUTH_SECURITY",
                               text: JSON.stringify({ enabled: newEnabledState, images: fpSetupImages.map(img => ({ originalDataUrl: img.dataUrl, keyword: img.keyword })) }),
                               timestamp: Date.now(),
                               starred: 0
                            }).catch(() => {});
                            setIsForgotPasswordEnabled(newEnabledState);
                            localStorage.setItem(`fp_setup_${currentUserId}`, JSON.stringify({ enabled: newEnabledState, images: fpSetupImages }));
                          }
                          setShowVerifyPassword(false);
                          setVerifyPasswordInput('');
                          setVerifyError(false);
                          setVerifyErrorMsg('');
                        } else {
                          const attemptsStr = localStorage.getItem(`verify_attempts_${currentUserId}`);
                          let attempts = attemptsStr ? parseInt(attemptsStr) : 0;
                          attempts += 1;
                          if (attempts >= 5) {
                            const expiry = Date.now() + 300000;
                            localStorage.setItem(`verify_lockout_${currentUserId}`, expiry.toString());
                            localStorage.setItem(`verify_attempts_${currentUserId}`, "0");
                            setVerifyLockoutTimer(300);
                            setVerifyErrorMsg(t('temporarilyBlocked', displayLang));
                          } else {
                            localStorage.setItem(`verify_attempts_${currentUserId}`, attempts.toString());
                            setVerifyErrorMsg(t('wrongPasswordAttempts', displayLang, 5 - attempts));
                          }
                          setVerifyPasswordInput('');
                          setVerifyError(true);
                        }
                      }}
                      disabled={verifyLockoutTimer > 0 || verifyPasswordInput.length !== 5}
className={`bg-transparent px-3 text-sm font-medium transition-colors outline-none ${verifyLockoutTimer > 0 || verifyPasswordInput.length !== 5 ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white cursor-pointer'}`}
                    >
                      {verifyLockoutTimer > 0 ? t('blocked', displayLang) : t('confirmAction', displayLang)}
                    </button>
                  </div>
                  {(verifyError || verifyLockoutTimer > 0) && (
                    <div className="text-red-400 text-xs text-right animate-in fade-in zoom-in-95 duration-200">
                      {verifyLockoutTimer > 0 ? t('blockedWait', displayLang, verifyLockoutTimer) : verifyErrorMsg || t('incorrectPassword', displayLang)}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 mt-4 w-full">
              <button 
                onClick={() => { setShowUserIdPopup(false); setTempLanguage(language); setShowLanguagePopup(true); }} 
                className="w-full cursor-pointer bg-white/10 text-white hover:bg-white/20 font-medium py-3 rounded-xl transition-all active:scale-95 text-base border-none outline-none"
              >
                {t('websiteLanguage', displayLang)}
              </button>
              <button 
                id="logout-btn"
                onClick={() => setShowLogoutConfirm(true)} 
                className="w-full cursor-pointer bg-transparent text-red-500 hover:text-red-400 font-medium py-2 transition-all hover:scale-105 active:scale-95 text-base border-none outline-none mt-2"
              >
                {t('logoutDeviceBtn', displayLang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeviceVerifyPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[#111] border border-white/10 p-8 rounded-3xl flex flex-col items-center gap-6 w-full max-w-sm shadow-[0_0_40px_rgba(0,0,0,0.8)] relative">
            <button 
              onClick={() => {
                setShowDeviceVerifyPopup(false);
                setVerifyPasswordInput('');
                setVerifyError(false);
                setShowNotificationsPopup(true);
                setReadNotifications(prev => {
                   const next = new Set(prev);
                   activeSecurityAttempts.forEach(a => next.add(a.attemptId));
                   if (currentUserId) localStorage.setItem(`read_notifications_${currentUserId}`, JSON.stringify(Array.from(next)));
                   return next;
                });
              }} 
              className="absolute top-6 left-6 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
            <div className="text-xl text-gray-300 font-light mt-2 mb-4">{t('confirmAction', displayLang)}</div>
            
            <div className="flex flex-col gap-2 animate-in fade-in duration-200 w-full">
              <div className="text-right text-gray-400 text-xs">
                {verifyAction === 'reject_device' ? t('enterPasswordToReject', displayLang)
                : verifyAction === 'accept_device' ? t('enterPasswordToAccept', displayLang)
                : verifyAction === 'logout_device' ? t('enterPasswordToLogout', displayLang)
                : verifyAction === 'ban_device' ? t('enterPasswordToBan', displayLang)
                : verifyAction === 'chat_device' ? t('enterPasswordToChat', displayLang) : ''}
              </div>
              <div className="flex gap-2">
                <input 
                  type="password"
                      value={verifyPasswordInput}
                  disabled={verifyLockoutTimer > 0}
                  onChange={(e) => {
                    setVerifyPasswordInput(e.target.value.replace(/[^0-9]/g, ''));
                    setVerifyError(false);
                    setVerifyErrorMsg('');
                  }}
                  maxLength={5}
                  className={`flex-1 bg-white/5 border rounded-xl p-3 text-center text-xl tracking-[0.5em] text-white focus:outline-none transition-colors font-mono ${verifyError ? 'border-red-500/50 focus:border-red-500' : 'border-white/20 focus:border-white'}`}
                  placeholder="•••••"
                  dir="ltr"
                  autoFocus
                />
                <button 
                  onClick={() => {
                    if (verifyLockoutTimer > 0) return;
                    if (verifyPasswordInput === currentPassword || (verifyPasswordInput && currentPassword && parseInt(verifyPasswordInput, 10) === parseInt(currentPassword, 10))) {
                      localStorage.removeItem(`verify_attempts_${currentUserId}`);
                      localStorage.removeItem(`verify_lockout_${currentUserId}`);
                      
                      if ((verifyAction === 'reject_device' || verifyAction === 'accept_device' || verifyAction === 'chat_device' || verifyAction === 'logout_device' || verifyAction === 'ban_device') && activeChatAttempt) {
                         const actionStr = verifyAction === 'reject_device' ? 'REJECT' : verifyAction === 'accept_device' ? 'ACCEPT' : verifyAction === 'logout_device' ? 'FORCE_LOGOUT' : verifyAction === 'ban_device' ? 'BAN' : 'CHAT';
                         appendToGoogleSheet({
                           action: "ADD",
                           id: `RES_${currentUserId}_${activeChatAttempt.attemptId}`,
                           userid: "USER_AUTH_RES",
                           text: JSON.stringify({ action: actionStr, attemptId: activeChatAttempt.attemptId, pass: actionStr === 'ACCEPT' ? currentPassword : null }),
                           timestamp: Date.now(),
                           starred: 0
                         });
                         setSecurityAttempts(prev => prev.map(a => a.attemptId === activeChatAttempt.attemptId ? {...a, action: actionStr} : a));
                         
                         setShowDeviceVerifyPopup(false);
                         setVerifyPasswordInput('');
                         setVerifyError(false);
                         setVerifyErrorMsg('');
                         
                         if (actionStr === 'CHAT') {
                             setShowOwnerChatPopup(true);
                         } else {
                             setShowNotificationsPopup(true);
                             setReadNotifications(prev => {
                                const next = new Set(prev);
                                activeSecurityAttempts.forEach(a => next.add(a.attemptId));
                                if (currentUserId) localStorage.setItem(`read_notifications_${currentUserId}`, JSON.stringify(Array.from(next)));
                                return next;
                             });
                         }
                      }
                    } else {
                      const attemptsStr = localStorage.getItem(`verify_attempts_${currentUserId}`);
                      let attempts = attemptsStr ? parseInt(attemptsStr) : 0;
                      attempts += 1;
                      if (attempts >= 5) {
                        const expiry = Date.now() + 300000;
                        localStorage.setItem(`verify_lockout_${currentUserId}`, expiry.toString());
                        localStorage.setItem(`verify_attempts_${currentUserId}`, "0");
                        setVerifyLockoutTimer(300);
                        setVerifyErrorMsg(t('temporarilyBlocked', displayLang));
                      } else {
                        localStorage.setItem(`verify_attempts_${currentUserId}`, attempts.toString());
                        setVerifyErrorMsg(t('wrongPasswordAttempts', displayLang, 5 - attempts));
                      }
                      setVerifyPasswordInput('');
                      setVerifyError(true);
                    }
                  }}
                  disabled={verifyLockoutTimer > 0 || verifyPasswordInput.length !== 5}
className={`bg-transparent px-3 text-sm font-medium transition-colors outline-none ${verifyLockoutTimer > 0 || verifyPasswordInput.length !== 5 ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white cursor-pointer'}`}
                >
                  {verifyLockoutTimer > 0 ? t('blocked', displayLang) : t('confirmAction', displayLang)}
                </button>
              </div>
              {(verifyError || verifyLockoutTimer > 0) && (
                <div className="text-red-400 text-xs text-right animate-in fade-in zoom-in-95 duration-200">
                  {verifyLockoutTimer > 0 ? t('blockedWait', displayLang, verifyLockoutTimer) : verifyErrorMsg || t('incorrectPassword', displayLang)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showNotificationsPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setShowNotificationsPopup(false)}>
          <div 
             className="bg-[#111] border border-white/10 p-6 flex flex-col w-full max-w-lg shadow-[0_0_40px_rgba(0,0,0,0.8)] relative max-h-[450px] rounded-3xl"
             onClick={(e) => e.stopPropagation()}
          >
             <button 
                  onClick={() => setShowNotificationsPopup(false)}
                  className="absolute p-3 top-3 left-3 text-gray-500 hover:text-white transition-colors cursor-pointer bg-transparent border-none outline-none z-10"
             >
                  <X size={24} strokeWidth={1.5} />
             </button>
             <div className="text-xl text-white font-medium mb-6 text-center pt-2">{t('notifications', displayLang)}</div>
             
             <div ref={notifScrollRef} className="overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-4">
               {notificationsList.length === 0 ? (
                 <div className="flex flex-col items-center justify-center py-10 opacity-50">
                    <Bell size={48} strokeWidth={1} className="text-white mb-4" />
                    <div className="text-xl text-white font-medium tracking-wide">{t('noNotifications', displayLang)}</div>
                 </div>
               ) : (
                 notificationsList.map((attempt, idx) => {
                     const date = new Date(attempt.time);
                     const lockoutMinutes = Math.floor(attempt.lockoutDuration / 60);
                     return (
                        <div key={idx} data-attempt-id={attempt.attemptId} className="notification-item bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
                           <div className="flex items-start justify-between">
                              <span className="text-sm text-gray-400 font-mono" dir="ltr">
                                 {date.getHours().toString().padStart(2, '0')}:{date.getMinutes().toString().padStart(2, '0')}:{date.getSeconds().toString().padStart(2, '0')} - {date.getDate()}/{date.getMonth()+1}/{date.getFullYear()}
                              </span>
                              <div className="flex items-center gap-3">
                                 <button
                                    onClick={() => {
                                        setHiddenNotifications(prev => {
                                            const next = new Set(prev);
                                            next.add(attempt.attemptId);
                                            return next;
                                        });
                                        // Delete from IndexedDB
                                        initLocalDB().then(db => {
                                           const tx = db.transaction('notifications', 'readwrite');
                                           tx.objectStore('notifications').delete(attempt.attemptId);
                                        }).catch(()=>{});
                                        // Delete from Google Sheets (attempts are stored as ATTEMPT_{userId}_{attemptId})
                                        appendToGoogleSheet({
                                           action: "DELETE",
                                           id: `ATTEMPT_${currentUserId}_${attempt.attemptId}`,
                                           userid: "DELETED",
                                           text: "[[DELETED]]",
                                           timestamp: Date.now(),
                                           starred: 0
                                        }).catch(()=>{});
                                        // Remove from state
                                        setSecurityAttempts(prev => prev.filter(a => a.attemptId !== attempt.attemptId));
                                    }}
                                    className="text-gray-500 hover:text-red-500 transition-colors cursor-pointer outline-none border-none bg-transparent p-1"
                                    title={t('deleteNotification', displayLang)}
                                 >
                                    <Trash2 size={20} />
                                 </button>
                              </div>
                           </div>
                           <div className="text-white text-right leading-relaxed" dir="rtl">
                              {t('deviceTryLoginWait', displayLang, attempt.device, lockoutMinutes)}
                           </div>
                           <div className="flex flex-wrap gap-2 mt-3 justify-end" dir="rtl">
                                {attempt.action === 'PENDING' || attempt.action === 'CHAT' || attempt.action === 'CLOSE_CHAT' ? (
                                  <>
                                    <button onClick={() => { setVerifyAction('reject_device'); setActiveChatAttempt(attempt); setShowDeviceVerifyPopup(true); setShowNotificationsPopup(false); }} className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-xl text-sm font-medium transition-colors cursor-pointer border border-transparent">{t('rejectAccess', displayLang)}</button>
                                    <button onClick={() => { setVerifyAction('accept_device'); setActiveChatAttempt(attempt); setShowDeviceVerifyPopup(true); setShowNotificationsPopup(false); }} className="px-4 py-2 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-xl text-sm font-medium transition-colors cursor-pointer border border-transparent">{t('acceptAccess', displayLang)}</button>
                                    {attempt.action === 'CHAT' ? (
                                      <button onClick={() => { setActiveChatAttempt(attempt); setShowOwnerChatPopup(true); setShowNotificationsPopup(false); }} className="px-5 py-2 bg-blue-500 text-white hover:bg-blue-600 rounded-xl text-sm font-medium transition-colors cursor-pointer border border-transparent">{t('openChat', displayLang)}</button>
                                    ) : (
                                      <button onClick={() => { setVerifyAction('chat_device'); setActiveChatAttempt(attempt); setShowDeviceVerifyPopup(true); setShowNotificationsPopup(false); }} className="px-4 py-2 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-xl text-sm font-medium transition-colors cursor-pointer border border-transparent">{t('sendMessage', displayLang)}</button>
                                    )}
                                  </>
                                ) : attempt.action === 'REJECT' ? (
                                  <>
                                    <div className="text-red-400 font-medium ml-auto my-auto px-2">{t('accessRejected', displayLang)}</div>
                                    <button onClick={() => { setVerifyAction('accept_device'); setActiveChatAttempt(attempt); setShowDeviceVerifyPopup(true); setShowNotificationsPopup(false); }} className="px-4 py-2 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-xl text-sm font-medium transition-colors cursor-pointer border border-transparent">{t('acceptAccess', displayLang)}</button>
                                  </>
                                ) : attempt.action === 'ACCEPT' ? (
                                  <>
                                    <div className="text-green-400 font-medium ml-auto my-auto px-2">{t('accessAccepted', displayLang)}</div>
                                    <button onClick={() => { setVerifyAction('logout_device'); setActiveChatAttempt(attempt); setShowDeviceVerifyPopup(true); setShowNotificationsPopup(false); }} className="px-4 py-2 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-xl text-sm font-medium transition-colors cursor-pointer border border-transparent">{t('logoutDeviceBtn', displayLang)}</button>
                                    <button onClick={() => { setVerifyAction('ban_device'); setActiveChatAttempt(attempt); setShowDeviceVerifyPopup(true); setShowNotificationsPopup(false); }} className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-xl text-sm font-medium transition-colors cursor-pointer border border-transparent">{t('banDeviceAlways', displayLang)}</button>
                                  </>
                                ) : attempt.action === 'FORCE_LOGOUT' ? (
                                  <>
                                    <div className="text-gray-400 font-medium ml-auto my-auto px-2">{t('loggedOut', displayLang)}</div>
                                    <button onClick={() => { setVerifyAction('accept_device'); setActiveChatAttempt(attempt); setShowDeviceVerifyPopup(true); setShowNotificationsPopup(false); }} className="px-4 py-2 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-xl text-sm font-medium transition-colors cursor-pointer border border-transparent">{t('acceptAccess', displayLang)}</button>
                                  </>
                                ) : attempt.action === 'BAN' ? (
                                  <>
                                    <div className="text-red-500 font-medium ml-auto my-auto px-2">{t('permanentlyBanned', displayLang)}</div>
                                    <button onClick={() => { setVerifyAction('accept_device'); setActiveChatAttempt(attempt); setShowDeviceVerifyPopup(true); setShowNotificationsPopup(false); }} className="px-4 py-2 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-xl text-sm font-medium transition-colors cursor-pointer border border-transparent">{t('acceptAccess', displayLang)}</button>
                                  </>
                                ) : null}
                             </div>
                        </div>
                     )
                 })
               )}
             </div>
             
             {notificationsList.length > 0 && (
                 <div className="pt-4 mt-4 border-t border-white/10 flex justify-start w-full" dir="ltr">
                     <button 
                        onClick={() => {
                            const allIds = notificationsList.map(a => a.attemptId);
                            setHiddenNotifications(prev => new Set([...prev, ...allIds]));
                            
                            initLocalDB().then(db => {
                               const tx = db.transaction('notifications', 'readwrite');
                               const store = tx.objectStore('notifications');
                               allIds.forEach(id => store.delete(id));
                            }).catch(()=>{});

                            Promise.all(allIds.map(id => 
                                appendToGoogleSheet({
                                   action: "DELETE",
                                   id: `ATTEMPT_${currentUserId}_${id}`,
                                   userid: "DELETED",
                                   text: "[[DELETED]]",
                                   timestamp: Date.now(),
                                   starred: 0
                                })
                            )).catch(()=>{});
                            
                            setSecurityAttempts(prev => prev.filter(a => !allIds.includes(a.attemptId)));
                        }}
                        className="text-red-500 hover:text-red-400 text-sm font-medium transition-colors bg-red-500/10 hover:bg-red-500/20 px-4 py-2 rounded-xl opacity-100 cursor-pointer w-auto"
                     >
                         {t('deleteAll', displayLang)}
                     </button>
                 </div>
             )}
          </div>
        </div>
      )}

      {lockoutChatVisible && currentView === 'login' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div 
             className="bg-[#111] border border-white/10 p-6 flex flex-col w-full max-w-lg shadow-[0_0_40px_rgba(0,0,0,0.8)] relative h-[80vh] rounded-3xl"
             onClick={(e) => e.stopPropagation()}
          >
             <div className="text-xl text-white font-medium mb-4 text-center pt-2">{t('chatWithOwnerClosed', displayLang)}</div>
             <div className="text-center text-red-400 text-sm mb-4">
                {t('youAreBlockedFor', displayLang, Math.ceil((loginLockoutTimer > 0 ? loginLockoutTimer : forgotPasswordLockout) / 60))}
             </div>
             
             <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3 pr-2 mb-4">
                 {lockoutChatMessages.map((msg, idx) => {
                     const isAttacker = msg.sender === 'ATTACKER';
                     return (
                        <div key={idx} className={`flex w-full ${isAttacker ? 'justify-end' : 'justify-start'}`}>
                           <div className={`p-3 rounded-2xl max-w-[80%] ${isAttacker ? 'bg-blue-500/20 border border-blue-500/30 text-blue-100 rounded-tr-sm' : 'bg-white/10 border border-white/10 text-white rounded-tl-sm'}`}>
                               <div dir="rtl" className="whitespace-pre-wrap">{msg.message}</div>
                               <div className="text-[10px] opacity-50 mt-1 text-right font-mono" dir="ltr">
                                  {new Date(msg.time).getHours().toString().padStart(2, '0')}:{new Date(msg.time).getMinutes().toString().padStart(2, '0')}:{new Date(msg.time).getSeconds().toString().padStart(2, '0')} - {new Date(msg.time).getDate()}/{new Date(msg.time).getMonth()+1}/{new Date(msg.time).getFullYear()}
                               </div>
                           </div>
                        </div>
                     );
                 })}
             </div>
             
             <div className="flex gap-2">
                 <input
                    type="text"
                    value={chatInputValue}
                    onChange={e => setChatInputValue(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            if (!chatInputValue.trim()) return;
                            const attemptId = localStorage.getItem(`lockout_attemptid_${loginId}`);
                            if (!attemptId) return;
                            const newChat = { attemptId, sender: 'ATTACKER', message: chatInputValue, time: Date.now() };
                            appendToGoogleSheet({
                               action: "ADD",
                               id: `CHAT_${loginId}_${attemptId}_${Date.now()}_${Math.random()}`,
                               userid: "USER_AUTH_CHAT",
                               text: JSON.stringify(newChat),
                               timestamp: Date.now(),
                               starred: 0
                            });
                            sendP2P(`app_owner_${loginId}`, { type: 'CHAT', chat: newChat });
                            setLockoutChatMessages(prev => [...prev, newChat]);
                            setChatInputValue('');
                        }
                    }}
                    dir="rtl"
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-white/30"
                    placeholder={t('typeMessage', displayLang)}
                 />
                 <button 
                    onClick={() => {
                        if (!chatInputValue.trim()) return;
                        const attemptId = localStorage.getItem(`lockout_attemptid_${loginId}`);
                        if (!attemptId) return;
                        const newChat = { attemptId, sender: 'ATTACKER', message: chatInputValue, time: Date.now() };
                        appendToGoogleSheet({
                           action: "ADD",
                           id: `CHAT_${loginId}_${attemptId}_${Date.now()}_${Math.random()}`,
                           userid: "USER_AUTH_CHAT",
                           text: JSON.stringify(newChat),
                           timestamp: Date.now(),
                           starred: 0
                        });
                        sendP2P(`app_owner_${loginId}`, { type: 'CHAT', chat: newChat });
                        setLockoutChatMessages(prev => [...prev, newChat]);
                        setChatInputValue('');
                    }}
                    className="p-3 bg-white hover:bg-gray-200 outline-none border-none text-black rounded-xl transition-colors shrink-0"
                 >
                    <Send size={20} style={{ transform: 'scaleX(-1)' }} />
                 </button>
             </div>
          </div>
        </div>
      )}

      {showOwnerChatPopup && activeChatAttempt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => {
           const actionStr = 'CLOSE_CHAT';
           appendToGoogleSheet({
             action: "ADD",
             id: `RES_${currentUserId}_${activeChatAttempt.attemptId}`,
             userid: "USER_AUTH_RES",
             text: JSON.stringify({ action: actionStr, attemptId: activeChatAttempt.attemptId, pass: null }),
             timestamp: Date.now(),
             starred: 0
           });
           setSecurityAttempts(prev => prev.map(a => a.attemptId === activeChatAttempt.attemptId ? {...a, action: actionStr} : a));
           setShowOwnerChatPopup(false);
        }}>
          <div 
             className="bg-[#111] border border-white/10 p-6 flex flex-col w-full max-w-lg shadow-[0_0_40px_rgba(0,0,0,0.8)] relative h-[80vh] rounded-3xl"
             onClick={(e) => e.stopPropagation()}
          >
             <button 
                  onClick={() => {
                     const actionStr = 'CLOSE_CHAT';
                     appendToGoogleSheet({
                       action: "ADD",
                       id: `RES_${currentUserId}_${activeChatAttempt.attemptId}`,
                       userid: "USER_AUTH_RES",
                       text: JSON.stringify({ action: actionStr, attemptId: activeChatAttempt.attemptId, pass: null }),
                       timestamp: Date.now(),
                       starred: 0
                     });
                     setSecurityAttempts(prev => prev.map(a => a.attemptId === activeChatAttempt.attemptId ? {...a, action: actionStr} : a));
                     setShowOwnerChatPopup(false);
                  }}
                  className="absolute p-3 top-3 left-3 text-gray-500 hover:text-white transition-colors cursor-pointer bg-transparent border-none outline-none z-10"
             >
                  <X size={24} strokeWidth={1.5} />
             </button>
             <div className="text-xl text-white font-medium mb-4 text-center pt-2">{t('chatWith', displayLang, activeChatAttempt.device)}</div>
             
             <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3 pr-2 mb-4">
                 {chatsData.filter(c => c.attemptId === activeChatAttempt.attemptId).sort((a,b) => a.time - b.time).map((msg, idx) => {
                     const isOwner = msg.sender === 'OWNER';
                     return (
                        <div key={idx} className={`flex w-full ${isOwner ? 'justify-end' : 'justify-start'}`}>
                           <div className={`p-3 rounded-2xl max-w-[80%] ${isOwner ? 'bg-blue-500/20 border border-blue-500/30 text-blue-100 rounded-tr-sm' : 'bg-white/10 border border-white/10 text-white rounded-tl-sm'}`}>
                               <div dir="rtl" className="whitespace-pre-wrap">{msg.message}</div>
                               <div className="text-[10px] opacity-50 mt-1 text-right font-mono" dir="ltr">
                                  {new Date(msg.time).getHours().toString().padStart(2, '0')}:{new Date(msg.time).getMinutes().toString().padStart(2, '0')}:{new Date(msg.time).getSeconds().toString().padStart(2, '0')} - {new Date(msg.time).getDate()}/{new Date(msg.time).getMonth()+1}/{new Date(msg.time).getFullYear()}
                               </div>
                           </div>
                        </div>
                     );
                 })}
             </div>
             
             <div className="flex gap-2">
                 <input
                    type="text"
                    value={chatInputValue}
                    onChange={e => setChatInputValue(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            if (!chatInputValue.trim()) return;
                            const newChat = { attemptId: activeChatAttempt.attemptId, sender: 'OWNER', message: chatInputValue, time: Date.now() };
                            appendToGoogleSheet({
                               action: "ADD",
                               id: `CHAT_${currentUserId}_${activeChatAttempt.attemptId}_${Date.now()}_${Math.random()}`,
                               userid: "USER_AUTH_CHAT",
                               text: JSON.stringify(newChat),
                               timestamp: Date.now(),
                               starred: 0
                            });
                            sendP2P(`app_attacker_${currentUserId}_${activeChatAttempt.attemptId}`, { type: 'CHAT', chat: newChat });
                            setChatsData(prev => [...prev, newChat]);
                            setChatInputValue('');
                        }
                    }}
                    dir="rtl"
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-white/30"
                    placeholder={t('typeMessage', displayLang)}
                 />
                 <button 
                    onClick={() => {
                        if (!chatInputValue.trim()) return;
                        const newChat = { attemptId: activeChatAttempt.attemptId, sender: 'OWNER', message: chatInputValue, time: Date.now() };
                        appendToGoogleSheet({
                           action: "ADD",
                           id: `CHAT_${currentUserId}_${activeChatAttempt.attemptId}_${Date.now()}_${Math.random()}`,
                           userid: "USER_AUTH_CHAT",
                           text: JSON.stringify(newChat),
                           timestamp: Date.now(),
                           starred: 0
                        });
                        sendP2P(`app_attacker_${currentUserId}_${activeChatAttempt.attemptId}`, { type: 'CHAT', chat: newChat });
                        setChatsData(prev => [...prev, newChat]);
                        setChatInputValue('');
                    }}
                    className="p-3 bg-white hover:bg-gray-200 outline-none border-none text-black rounded-xl transition-colors shrink-0"
                 >
                    <Send size={20} style={{ transform: 'scaleX(-1)' }} />
                 </button>
             </div>
          </div>
        </div>
      )}

      {showAddImagePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => { setShowAddImagePopup(false); setImagePreviews([]); }}>
          <div 
             className="bg-[#111] border border-white/10 p-6 rounded-3xl flex flex-col gap-4 w-full max-w-2xl max-h-[85vh] shadow-[0_0_40px_rgba(0,0,0,0.8)] relative"
             onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center w-full pb-1" dir="rtl">
              <div className="text-xl text-gray-300 font-medium">{t('addImagesTitle', displayLang)}</div>
              <button 
                onClick={() => { setShowAddImagePopup(false); setImagePreviews([]); }}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer text-base bg-transparent border-none outline-none"
              >
                {t('cancel', displayLang)}
              </button>
            </div>
            
            <div 
              className={`w-full min-h-[16rem] bg-white/5 border border-dashed border-white/20 hover:border-white/40 rounded-2xl transition-colors relative p-4 ${imagePreviews.length === 0 ? 'flex flex-col items-center justify-center overflow-y-auto' : 'grid grid-cols-2 md:grid-cols-5 gap-4 overflow-y-auto items-start'}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault(); e.stopPropagation();
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleImageFiles(Array.from(e.dataTransfer.files));
                }
              }}
            >
              <input 
                type="file" 
                multiple
                accept="image/*, .heic, .heif, .webp, .svg, .bmp, .gif, .png, .jpg, .jpeg, .tiff, .ico" 
                className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer ${imagePreviews.length > 0 ? 'hidden' : ''}`}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleImageFiles(Array.from(e.target.files));
                  }
                }}
              />
              
              {imagePreviews.map((preview, index) => (
                <div key={index} className="relative aspect-square w-full group bg-black/20 rounded-xl overflow-hidden border border-white/10 flex items-center justify-center">
                  <img src={preview} alt="Preview" className="max-w-full max-h-full object-contain" />
                  <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        setImagePreviews(prev => prev.filter((_, i) => i !== index));
                    }}
                    className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black text-white rounded-full transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 z-10"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              
              {imagePreviews.length > 0 && imagePreviews.length < 3 && (
                <div 
                  className="aspect-square w-full bg-white/5 hover:bg-white/10 border border-dashed border-white/20 hover:border-white/40 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer group"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.accept = 'image/*, .heic, .heif, .webp, .svg, .bmp, .gif, .png, .jpg, .jpeg, .tiff, .ico';
                    input.onchange = (e: any) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleImageFiles(Array.from(e.target.files));
                      }
                    };
                    input.click();
                  }}
                >
                  <Plus size={24} className="text-gray-500 group-hover:text-white transition-colors" />
                </div>
              )}
              
              {imagePreviews.length === 0 && (
                <>
                  <UploadCloud size={40} strokeWidth={1} className="text-gray-400 mb-2" />
                  <span className="text-gray-400 font-light">{t('attachOrDragImages', displayLang)}</span>
                </>
              )}
            </div>
            
            <div className="flex justify-between items-center w-full mt-2" dir="rtl">
              <div className="text-sm text-gray-500">{t('imagesSelected', displayLang, imagePreviews.length)}</div>
              <button 
                onClick={async () => {
                  if (imagePreviews.length === 0) return;
                  
                  // Show loading feedback
                  const btn = document.getElementById('add-all-btn') as HTMLButtonElement;
                  if (btn) {
                    btn.disabled = true;
                    btn.textContent = t('uploading', displayLang);
                  }

                  const newItems: TextItem[] = imagePreviews.map((preview, i) => ({
                    id: generateTextId() + "_" + i,
                    userId: currentUserId,
                    text: preview,
                    timestamp: Date.now() + i,
                    synced: false // Initially not synced, will mark synced if successful
                  }));
                  
                  setTexts((prev) => [...newItems.reverse(), ...prev]);
                  
                  setShowAddImagePopup(false);
                  setImagePreviews([]);
                  
                  // Parallel, super-fast individual uploads
                  (async () => {
                    await Promise.all(newItems.map(async (item) => {
                      try {
                        await saveTextToDB(item);
                        // Mark as synced if successful
                        setTexts(prev => prev.map(t => t.id === item.id ? { ...t, synced: true } : t));
                      } catch (e) {
                         console.error("Failed to upload image item", e);
                      }
                    }));
                  })();
                }} 
                id="add-all-btn"
                disabled={imagePreviews.length === 0}
                className={`px-8 py-2 rounded-full font-medium transition-all text-lg ${imagePreviews.length > 0 ? 'bg-white text-black hover:bg-gray-200 cursor-pointer hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(255,255,255,0.2)]' : 'bg-white/20 text-gray-500 cursor-not-allowed'}`}
              >
                {t('addAll', displayLang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddTextPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => { setShowAddTextPopup(false); stopRecordingUserAction(); }}>
          <div 
             className="bg-[#111] border border-white/10 p-6 rounded-3xl flex flex-col gap-4 w-full max-w-xl shadow-[0_0_40px_rgba(0,0,0,0.8)] relative"
             onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center w-full pb-1" dir="rtl">
              <div className="text-xl text-gray-300 font-medium">{t('addNewText', displayLang)}</div>
              <button 
                onClick={() => { setShowAddTextPopup(false); stopRecordingUserAction(); }}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer text-base bg-transparent border-none outline-none"
              >
                {t('cancel', displayLang)}
              </button>
            </div>
            <div className="w-full h-48 bg-white/5 border border-white/10 rounded-2xl flex flex-row focus-within:border-white/30 transition-colors" dir="rtl">
              <textarea
                value={newText}
                onChange={(e) => {
                  setNewText(e.target.value);
                  recordingTextRef.current = e.target.value;
                }}
                placeholder={t('typeYourText', displayLang)}
                className="flex-1 bg-transparent p-4 text-white placeholder:text-gray-600 focus:outline-none resize-none text-lg leading-relaxed custom-scrollbar h-full"
                dir="rtl"
              />
              <div className="w-14 border-r border-white/10 flex items-end justify-center pb-3 flex-shrink-0">
                <button
                  type="button"
                  className={`p-2 rounded-full transition-all duration-300 flex items-center justify-center ${isRecording ? 'bg-red-500/30 text-red-500 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.6)] scale-110' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'}`}
                  onClick={() => toggleRecording(setNewText, newText)}
                  title={t('speak', displayLang)}
                >
                  <Mic size={20} />
                </button>
              </div>
            </div>
            <div className="flex justify-end w-full mt-2">
              <button 
                onClick={() => {
                  if (!newText.trim()) return;
                  
                  (async () => {
                    const MAX_LEN = 48000;
                    if (newText.trim().length <= MAX_LEN) {
                      const newItem: TextItem = {
                        id: generateTextId(),
                        userId: currentUserId,
                        text: newText.trim(),
                        timestamp: Date.now()
                      };
                      setTexts((prev) => [newItem, ...prev]);
                      // Save in background
                      saveTextToDB(newItem).catch(e => console.error(e));
                    } else {
                      const fullText = newText.trim();
                      const numChunks = Math.ceil(fullText.length / MAX_LEN);
                      const newItems: TextItem[] = [];
                      const baseId = generateTextId();
                      
                      for (let i = 0; i < numChunks; i++) {
                        const chunkText = fullText.substring(i * MAX_LEN, (i + 1) * MAX_LEN);
                        const chunkItem: TextItem = {
                          id: i === 0 ? baseId : `${baseId}_p${i}`,
                          userId: currentUserId,
                          text: chunkText + '\n\n' + t('partOf', displayLang, i + 1, numChunks),
                          timestamp: Date.now() + i
                        };
                        newItems.push(chunkItem);
                        saveTextToDB(chunkItem).catch(e => console.error(e));
                      }
                      // newItems have higher timestamp last, so we reverse to put newest at front
                      setTexts((prev) => [...newItems.reverse(), ...prev]);
                    }

                    setShowAddTextPopup(false);
                    stopRecordingUserAction();
                    setNewText('');
                  })();
                }}
                disabled={!newText.trim()}
                className={`w-32 py-2 rounded-full font-medium transition-all text-lg ${newText.trim() ? 'bg-white text-black hover:bg-gray-200 cursor-pointer hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(255,255,255,0.2)]' : 'bg-white/20 text-gray-500 cursor-not-allowed'}`}
              >
                {t('add', displayLang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setShowDeleteConfirm(false)}>
          <div 
             className="bg-[#111] border border-white/10 p-8 rounded-3xl flex flex-col items-center gap-6 w-full max-w-sm shadow-[0_0_40px_rgba(0,0,0,0.8)]"
             onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xl text-gray-200 font-medium text-center">
              {t('confirmDelete', displayLang)}
            </div>
            <div className="text-gray-400 text-center text-sm leading-relaxed" dir="rtl">
              {t('areYouSureDeleteSelected', displayLang, selectedTexts.size)}
            </div>
            <div className="flex gap-4 w-full mt-2">
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-full transition-all active:scale-95 text-lg"
              >
                {t('cancel', displayLang)}
              </button>
              <button 
                onClick={deleteSelectedTexts}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-medium py-3 rounded-full transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)] active:scale-95 text-lg"
              >
                {t('deleteBtn', displayLang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Text Popup */}
      {showEditTextPopup && editTextItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => {
            setShowEditTextPopup(false);
            stopRecordingUserAction();
            setEditTextItem(null);
            setEditTextInput('');
          }}>
          <div 
             className="bg-[#111] border border-white/10 p-6 rounded-3xl flex flex-col gap-4 w-full max-w-xl shadow-[0_0_40px_rgba(0,0,0,0.8)] relative"
             onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center w-full pb-1" dir="rtl">
              <div className="text-xl text-gray-300 font-medium">{t('editOriginalText', displayLang)}</div>
              <button 
                onClick={() => {
                  setShowEditTextPopup(false);
                  stopRecordingUserAction();
                  setEditTextItem(null);
                  setEditTextInput('');
                }}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer text-base bg-transparent border-none outline-none"
              >
                {t('cancel', displayLang)}
              </button>
            </div>
            <div className="w-full h-48 bg-white/5 border border-white/10 rounded-2xl flex flex-row focus-within:border-white/30 transition-colors" dir="rtl">
              <textarea
                value={editTextInput}
                onChange={(e) => {
                  setEditTextInput(e.target.value);
                  recordingTextRef.current = e.target.value;
                }}
                placeholder={t('typeYourEditHere', displayLang)}
                className="flex-1 bg-transparent p-4 text-white placeholder:text-gray-600 focus:outline-none resize-none text-lg leading-relaxed custom-scrollbar h-full"
                dir="rtl"
              />
              <div className="w-14 border-r border-white/10 flex items-end justify-center pb-3 flex-shrink-0">
                <button
                  type="button"
                  className={`p-2 rounded-full transition-all duration-300 flex items-center justify-center ${isRecording ? 'bg-red-500/30 text-red-500 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.6)] scale-110' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'}`}
                  onClick={() => toggleRecording(setEditTextInput, editTextInput)}
                  title={t('speak', displayLang)}
                >
                  <Mic size={20} />
                </button>
              </div>
            </div>
            <div className="flex justify-end w-full mt-2">
              <button 
                onClick={() => {
                  if (!editTextInput.trim()) return;

                  (async () => {
                    const MAX_LEN = 48000;
                    if (editTextInput.trim().length <= MAX_LEN) {
                      const updatedItem: TextItem = {
                        ...editTextItem,
                        text: editTextInput.trim()
                      };
                      
                      setTexts((prev) => prev.map(t => t.id === updatedItem.id ? updatedItem : t));
                      saveTextToDB(updatedItem, true).catch(e => console.error(e));
                    } else {
                      // If it's an update and now it's too long, delete old and re-chunk
                      deleteTextsFromDB([editTextItem.id], currentUserId).catch(e => console.error(e));
                      setTexts((prev) => prev.filter(t => t.id !== editTextItem.id));
                      
                      const fullText = editTextInput.trim();
                      const numChunks = Math.ceil(fullText.length / MAX_LEN);
                      const newItems: TextItem[] = [];
                      const baseId = editTextItem.id;
                      
                      for (let i = 0; i < numChunks; i++) {
                        const chunkText = fullText.substring(i * MAX_LEN, (i + 1) * MAX_LEN);
                        const chunkItem: TextItem = {
                          id: i === 0 ? baseId : `${baseId}_p${i}`,
                          userId: currentUserId,
                          text: chunkText + '\n\n' + t('partOf', displayLang, i + 1, numChunks),
                          timestamp: editTextItem.timestamp + i,
                          starred: editTextItem.starred
                        };
                        saveTextToDB(chunkItem).catch(e => console.error(e));
                        newItems.push(chunkItem);
                      }
                      setTexts((prev) => [...newItems.reverse(), ...prev]);
                    }
                    
                    setShowEditTextPopup(false);
                    stopRecordingUserAction();
                    setEditTextItem(null);
                    setEditTextInput('');
                  })();
                }} 
                disabled={!editTextInput.trim() || editTextInput.trim() === editTextItem.text}
                className={`w-32 py-2 rounded-full font-medium transition-all text-lg ${editTextInput.trim() && editTextInput.trim() !== editTextItem.text ? 'bg-white text-black hover:bg-gray-200 cursor-pointer hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(255,255,255,0.2)]' : 'bg-white/20 text-gray-500 cursor-not-allowed'}`}
              >
                {t('editBtn', displayLang)}
              </button>
            </div>
          </div>
        </div>
      )}
      {showForgotPwdRecoveryModal && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 backdrop-blur-md px-4 pt-10" onClick={() => setShowForgotPwdRecoveryModal(false)}>
          <div 
             className="bg-[#111] border border-white/10 rounded-[32px] flex flex-col w-full max-w-lg shadow-[0_0_50px_rgba(0,0,0,1)] relative overflow-hidden max-h-[85vh]"
             onClick={(e) => e.stopPropagation()}
             dir="rtl"
          >
             <div className="p-6 border-b border-white/5 shrink-0 flex items-center justify-between">
                <button 
                  onClick={() => setShowForgotPwdRecoveryModal(false)} 
                  className="p-1 text-gray-500 hover:text-white transition-colors cursor-pointer"
                >
                  <X size={24} />
                </button>
                <div className="text-lg md:text-xl text-white tracking-wide font-medium">{t('loginWithoutPasswordTitle', displayLang)}</div>
                <div className="w-8"></div>
             </div>
             
             <div className="p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
                <div className="text-center text-gray-400 text-base font-medium mt-2">
                   {t('chooseSecurityImages', displayLang)}
                </div>
                
                <div className="relative min-h-[300px]">
                   {loadedImagesCount < (recoveryOptions?.length || 25) && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#111] z-20">
                          <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
                          <div className="text-gray-400 text-sm font-medium" dir="ltr">{t('loadingImages', displayLang, loadedImagesCount, recoveryOptions?.length || 25)}</div>
                      </div>
                   )}
                   <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-2">
                      {recoveryOptions?.map((opt: any, idx: number) => {
                         const isSelected = recoverySelected.includes(opt.id);
                         return (
                           <div 
                              key={idx}
                              onClick={() => {
                                 let updated = [...recoverySelected];
                                 if (isSelected) {
                                   updated = updated.filter(id => id !== opt.id);
                                 } else if (updated.length < 5) {
                                   updated.push(opt.id);
                                 }
                                 setRecoverySelected(updated);
                              }}
                              className={`aspect-square rounded-2xl overflow-hidden cursor-pointer flex items-center justify-center transition-all border-4 relative bg-[#111] ${isSelected ? 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.6)] scale-105 z-10' : 'border-transparent hover:border-white/20'}`}
                           >
                              <img 
                                src={opt.url} 
                                alt={t('recoveryOptionsAlt', displayLang)} 
                                className="w-full h-full object-contain" 
                                onLoad={() => setLoadedImagesCount(c => c + 1)}
                                onError={() => setLoadedImagesCount(c => c + 1)}
                              />
                              {isSelected && (
                                 <div className="absolute top-2 left-2 bg-blue-500 text-white p-1 rounded-full shadow-lg flex items-center justify-center w-6 h-6">
                                    <Check size={16} />
                                 </div>
                              )}
                           </div>
                         )
                      })}
                   </div>
                </div>
             </div>
             
             <div className="p-6 pt-2 shrink-0">
                 <button
                    onClick={() => {
                       if (recoverySelected.length !== 5) return;
                       
                       let allCorrect = true;
                       for (let i = 0; i < 5; i++) {
                          if (!recoverySelected[i].startsWith('original')) {
                             allCorrect = false;
                             break;
                          }
                       }
                       
                       if (allCorrect) {
                              setRecoveryError('');
                              setShowForgotPwdRecoveryModal(false);
                              
                              // Trigger successful login
                              localStorage.removeItem(`login_attempts_${loginId}`);
                              localStorage.removeItem(`login_lockout_${loginId}`);
                              localStorage.removeItem(`forgot_pwd_failures_${loginId}`);
                              localStorage.removeItem(`forgot_pwd_lockout_${loginId}`);
                              setForgotPasswordLockout(0);
                              
                              setCurrentUserId(loginId);
                              setCurrentPassword(recoveryUserPass);
                              setLoginPassword(recoveryUserPass);
                              saveSession(loginId, recoveryUserPass);
                              
                              // Sync missing remote texts locally before opening dashboard?
                              // Just open it, sync logic runs anyway
                              setCurrentView('dashboard');
                           } else {
                              setShowForgotPwdRecoveryModal(false);
                              
                              // Lockout calculation
                              const prevFailures = parseInt(localStorage.getItem(`forgot_pwd_failures_${loginId}`) || '0');
                              const newFailures = prevFailures + 1;
                              localStorage.setItem(`forgot_pwd_failures_${loginId}`, newFailures.toString());
                              
                              let lockoutMinutes = 5;
                              if (newFailures === 1) lockoutMinutes = 5;
                              else if (newFailures === 2) lockoutMinutes = 10;
                              else if (newFailures === 3) lockoutMinutes = 30;
                              else if (newFailures === 4) lockoutMinutes = 60;
                              else lockoutMinutes = 24 * 60;
                              
                              const expiry = Date.now() + (lockoutMinutes * 60 * 1000);
                              localStorage.setItem(`forgot_pwd_lockout_${loginId}`, expiry.toString());
                              setForgotPasswordLockout(lockoutMinutes * 60);

                              const attemptId = Date.now().toString() + Math.random().toString().slice(2, 8);
                              localStorage.setItem(`lockout_attemptid_${loginId}`, attemptId);
                              
                              const attemptData = {
                                   attemptId,
                                   device: navigator.platform || t('unknownDevice', displayLang),
                                   time: Date.now(),
                                   action: 'PENDING',
                                   lockoutDuration: lockoutMinutes * 60
                              };
                              appendToGoogleSheet({
                                action: "ADD",
                                id: `ATTEMPT_${loginId}_${attemptId}`,
                                userid: "USER_AUTH_ATTEMPT",
                                text: JSON.stringify(attemptData),
                                timestamp: Date.now(),
                                starred: 0
                              }).catch(e => console.error(e));

                              sendP2P(`app_owner_${loginId}`, { type: 'NEW_ATTEMPT', attempt: attemptData });
                           }
                    }}
                    disabled={recoverySelected.length !== 5}
                    className={`w-full py-4 rounded-xl text-lg font-medium transition-all min-h-[60px] ${recoverySelected.length === 5 ? 'bg-white text-black hover:bg-gray-200 cursor-pointer shadow-[0_0_15px_rgba(255,255,255,0.2)] hover:scale-105 active:scale-95' : 'bg-white/10 text-gray-500 cursor-not-allowed'}`}
                 >
                    {t('loginBtn', displayLang)}
                 </button>
             </div>
          </div>
        </div>
      )}
      {showForgotPasswordSetup && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setShowForgotPasswordSetup(false)}>
          <div 
            className="bg-[#111] border border-white/10 rounded-[32px] flex flex-col w-full max-w-md shadow-[0_0_40px_rgba(0,0,0,0.8)] relative max-h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            dir="ltr"
          >
            <div className="flex items-center justify-between p-6 border-b border-white/5 shrink-0">
              <div className="w-8"></div>
              <div className="text-xl text-gray-200 font-medium tracking-wide">{t('showFpButton', displayLang)}</div>
              <button 
                onClick={() => { setShowForgotPasswordSetup(false); setShowUserIdPopup(true); }} 
                className="p-1 text-gray-500 hover:text-white transition-colors cursor-pointer"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6">
              <div className="text-sm text-gray-400 text-center">
                {t('add5ImagesDocs', displayLang)}
              </div>
              
              <div className="flex flex-col gap-4">
                {fpSetupImages.map((img, idx) => (
                  <div key={idx} className="flex flex-col gap-3 p-4 bg-black/40 border border-white/5 rounded-2xl relative group">
                    <button 
                      onClick={() => {
                        setFpSetupImages(prev => prev.filter((_, i) => i !== idx));
                      }}
                      className="absolute top-2 left-2 p-1.5 bg-black/60 hover:bg-black text-white rounded-full opacity-100 transition-colors z-10 md:opacity-0 md:group-hover:opacity-100"
                    >
                      <X size={16} />
                    </button>
                    <div className="w-full flex justify-center bg-[#111] overflow-hidden rounded-xl">
                       <img src={img.dataUrl} className="object-contain w-full max-h-[400px]" alt="fp-img" />
                    </div>
                    <input 
                      type="text"
                      value={img.keyword}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^a-zA-Z0-9.\- ]/g, '');
                        setFpSetupImages(prev => prev.map((item, i) => i === idx ? { ...item, keyword: val } : item));
                      }}
                      placeholder={t('imageDescEnglish', displayLang)}
                      className="w-full bg-white/5 border border-white/20 rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-white transition-colors"
                      dir="ltr"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-center">
                <input 
                  type="file" 
                  accept="image/*, .heic, .heif, .webp, .svg, .bmp, .gif, .png, .jpg, .jpeg, .tiff, .ico" 
                  multiple
                  className="hidden" 
                  id="fp-upload"  
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []) as File[];
                    if (!files.length) return;
                    let newImages = [...fpSetupImages];
                    for (const file of files) {
                      if (newImages.length >= 5) break;
                      const dataUrl = await resizeImageToWebP(file);
                      newImages.push({ dataUrl, keyword: '' });
                    }
                    setFpSetupImages(newImages);
                    e.target.value = '';
                  }}
                />
                <label 
                  htmlFor="fp-upload" 
                  className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl ${fpSetupImages.length >= 5 ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-white/10 hover:bg-white/20 text-white cursor-pointer'} transition-colors w-full`}
                >
                  <Plus size={20} />
                  <span>{t('addImageCount', displayLang, fpSetupImages.length)}</span>
                </label>
              </div>
              <div className="flex justify-center mt-2 pb-6">
                 <button
                    onClick={async () => {
                      if ((fpSetupImages.length !== 5 && fpSetupImages.length !== 0) || fpSetupImages.some(i => !i.keyword.trim())) return;
                      setFpSetupLoading(true);
                      
                      if (fpSetupImages.length === 0) {
                         localStorage.removeItem(`fp_setup_${currentUserId}`);
                         await appendToGoogleSheet({
                           action: "ADD",
                           id: `${currentUserId}_SECIMG`,
                           userid: "USER_AUTH_SECURITY",
                           text: JSON.stringify({ enabled: false, images: [] }),
                           timestamp: Date.now(),
                           starred: 0
                         });
                         setIsForgotPasswordEnabled(false);
                         setFpSetupLoading(false);
                         setShowForgotPasswordSetup(false);
                         setShowUserIdPopup(true);
                         return;
                      }
                      
                      const generatedSetup = fpSetupImages.map((img, i) => {
                         const keyword = img.keyword.trim().toLowerCase();
                         const encodedKw = encodeURIComponent(keyword) || 'random';
                         return {
                           id: String(i),
                           originalDataUrl: img.dataUrl,
                           keyword: keyword,
                           dummyUrls: [
                             `https://loremflickr.com/320/240/${encodedKw}?lock=${Math.floor(Math.random() * 1000000) + 1}`,
                             `https://loremflickr.com/320/240/${encodedKw}?lock=${Math.floor(Math.random() * 1000000) + 1}`,
                             `https://loremflickr.com/320/240/${encodedKw}?lock=${Math.floor(Math.random() * 1000000) + 1}`,
                             `https://loremflickr.com/320/240/${encodedKw}?lock=${Math.floor(Math.random() * 1000000) + 1}`
                           ]
                         };
                      });
                      
                      localStorage.setItem(`fp_setup_${currentUserId}`, JSON.stringify({ images: generatedSetup }));
  
                      await appendToGoogleSheet({
                        action: "ADD",
                        id: `${currentUserId}_SECIMG`,
                        userid: "USER_AUTH_SECURITY",
                        text: JSON.stringify({ enabled: true, images: generatedSetup }),
                        timestamp: Date.now(),
                        starred: 0
                      });
  
                      setIsForgotPasswordEnabled(true);
                      setFpSetupLoading(false);
                      setShowForgotPasswordSetup(false);
                      setShowUserIdPopup(true);
                    }}
                    disabled={!((fpSetupImages.length === 5 || fpSetupImages.length === 0) && !fpSetupImages.some(i => !i.keyword.trim()) && JSON.stringify(fpSetupImages) !== initialFpSetupImagesStr && !fpSetupLoading)}
                    className={`w-48 px-4 py-3 rounded-full text-base font-medium transition-all flex items-center justify-center min-h-[44px] ${((fpSetupImages.length === 5 || fpSetupImages.length === 0) && !fpSetupImages.some(i => !i.keyword.trim()) && JSON.stringify(fpSetupImages) !== initialFpSetupImagesStr && !fpSetupLoading) ? 'bg-white text-black hover:bg-gray-200 cursor-pointer shadow-[0_0_15px_rgba(255,255,255,0.2)] hover:scale-105 active:scale-95' : 'bg-white/10 text-gray-500 cursor-not-allowed'}`}
                 >
                   {fpSetupLoading ? (
                      <div className="w-4 h-4 border-2 border-gray-500 border-t-white rounded-full animate-spin"></div>
                   ) : t('save', displayLang)}
                 </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setShowLogoutConfirm(false)}>
          <div 
             className="bg-[#111] border border-white/10 p-6 rounded-3xl flex flex-col gap-6 w-full max-w-sm shadow-[0_0_40px_rgba(0,0,0,0.8)] relative text-center"
             onClick={(e) => e.stopPropagation()}
             dir="ltr"
          >
            <div className="text-xl text-white font-medium">{t('logoutConfirmTitle', displayLang)}</div>
            <div className="flex gap-4 w-full">
              <button 
                onClick={() => {
                  setShowLogoutConfirm(false);
                  handleLogout();
                }} 
                className="flex-1 cursor-pointer bg-red-500 hover:bg-red-600 text-white font-medium py-3 rounded-full transition-all hover:scale-105 active:scale-95 text-lg"
              >
                {t('yes', displayLang)}
              </button>
              <button 
                onClick={() => setShowLogoutConfirm(false)} 
                className="flex-1 cursor-pointer bg-white/10 hover:bg-white/20 text-white font-medium py-3 rounded-full transition-all hover:scale-105 active:scale-95 text-lg"
              >
                {t('no', displayLang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewedItem && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md px-4" onClick={() => setViewedItem(null)}>
          <div 
             className="relative flex flex-col items-center justify-center max-w-4xl max-h-[90vh] w-full shadow-[0_0_50px_rgba(0,0,0,1)] rounded-3xl"
             onClick={(e) => e.stopPropagation()}
          >
             <button 
                  onClick={() => setViewedItem(null)}
                  className="absolute -top-10 left-0 md:-top-8 md:-left-8 p-2 bg-transparent text-white hover:text-white/70 transition-colors cursor-pointer z-10"
             >
                  <X size={28} strokeWidth={1.5} />
             </button>
             <div className="w-full max-h-[75vh] bg-[#111] border border-white/10 rounded-3xl overflow-hidden relative flex flex-col">
                 <div className="w-full overflow-y-auto custom-scrollbar p-6 md:p-10">
                     {viewedItem.text.startsWith('data:image/') ? (
                         <img src={viewedItem.text} alt={t('viewImageAlt', displayLang)} className="w-full h-auto max-h-[70vh] object-contain rounded-xl" />
                     ) : (
                         <div className="text-white whitespace-pre-wrap text-[18px] md:text-[22px] leading-relaxed w-full break-words text-right" dir="auto">
                             {viewedItem.text}
                         </div>
                     )}
                 </div>
             </div>
             
             <div className="mt-4 flex items-center justify-center gap-6 bg-black/80 backdrop-blur-md px-6 py-3 rounded-full border border-white/10 shadow-lg shrink-0">
                 <button 
                     onClick={(e) => handleCopy(viewedItem.text, viewedItem.id, e)} 
                     className="text-gray-300 hover:text-white transition-colors flex items-center gap-2 cursor-pointer bg-transparent border-none outline-none"
                 >
                     {copiedId === viewedItem.id ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
                     <span className="text-sm font-medium">{t('copy', displayLang)}</span>
                 </button>
                 <div className="w-[1px] h-5 bg-white/20"></div>
                 <button 
                     onClick={(e) => {
                         if (viewedItem.text.startsWith('data:image/')) {
                             handleCopy(viewedItem.text, viewedItem.id);
                         } else {
                             navigator.clipboard.writeText(viewedItem.text);
                         }
                         setShareModalText(viewedItem.text);
                     }} 
                     className="text-gray-300 hover:text-white transition-colors flex items-center gap-2 cursor-pointer bg-transparent border-none outline-none"
                 >
                     <Share2 size={20} />
                     <span className="text-sm font-medium">{t('share', displayLang)}</span>
                 </button>
                 <div className="w-[1px] h-5 bg-white/20"></div>
                 <button 
                     onClick={(e) => {
                         const currentItem = texts.find(t => t.id === viewedItem.id) || viewedItem;
                         const updatedItem = { ...currentItem, starred: !currentItem.starred };
                         setTexts(prev => prev.map(t => t.id === updatedItem.id ? updatedItem : t));
                         setViewedItem(updatedItem);
                         saveTextToDB(updatedItem, true).catch(console.error);
                     }} 
                     className={`transition-colors flex items-center gap-2 outline-none border-none bg-transparent cursor-pointer ${texts.find(t => t.id === viewedItem.id)?.starred || viewedItem.starred ? 'text-yellow-500 hover:text-yellow-400' : 'text-gray-300 hover:text-white'}`}
                     title={(texts.find(t => t.id === viewedItem.id)?.starred || viewedItem.starred) ? t('removeStar', displayLang) : t('addStar', displayLang)}
                 >
                     <Star size={20} className={(texts.find(t => t.id === viewedItem.id)?.starred || viewedItem.starred) ? "fill-yellow-500" : ""} />
                     <span className="text-sm font-medium">{t('highlight', displayLang)}</span>
                 </button>
             </div>
          </div>
        </div>
      )}

      {shareModalText && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setShareModalText(null)}>
          <div 
            className="bg-[#111] border border-white/10 rounded-[32px] flex flex-col w-full max-w-md shadow-[0_0_40px_rgba(0,0,0,0.8)] relative max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex justify-between items-center w-full p-6 pb-4 border-b border-white/10">
              <div className="text-xl text-white font-medium">{t('shareVia', displayLang)}</div>
              <button 
                onClick={() => setShareModalText(null)}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer bg-transparent border-none outline-none"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              <div className="text-sm text-green-400 mb-6 font-medium text-center bg-green-400/10 py-3 rounded-xl">
                {shareModalText?.startsWith('data:image/') ? t('imageCopied', displayLang) : t('textCopied', displayLang)}
              </div>

              {navigator.share && typeof navigator.share === 'function' && (
                <button
                  onClick={async () => {
                    try {
                      if (shareModalText?.startsWith('data:image/')) {
                          const res = await fetch(shareModalText);
                          const blob = await res.blob();
                          const file = new File([blob], 'shared_image.png', { type: blob.type });
                          if (navigator.canShare && navigator.canShare({ files: [file] })) {
                              await navigator.share({ files: [file] });
                          } else {
                              alert(t('deviceShareNotSupported', displayLang));
                          }
                      } else {
                          await navigator.share({
                            text: shareModalText || '',
                          });
                      }
                    } catch (err) {
                      console.log('Error sharing:', err);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-3 p-4 mb-6 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-400 transition-colors cursor-pointer"
                >
                  <Share2 size={20} />
                  <span className="font-medium">{t('shareViaDeviceApps', displayLang)}</span>
                </button>
              )}

              <div className="grid grid-cols-2 gap-3" dir="ltr">
                {sharePlatforms.map((platform) => {
                  const href = `https://${platform.domain}`;
                  
                  return (
                  <a
                    key={platform.name}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (shareModalText?.startsWith('data:image/')) {
                          // Already copied when share modal opened!
                          alert(t('imageCopiedOpeningPlatform', displayLang));
                      } else {
                          navigator.clipboard.writeText(shareModalText || '');
                          alert(t('textCopiedOpeningPlatform', displayLang));
                      }
                      setTimeout(() => setShareModalText(null), 100);
                    }}
                    className="flex items-center justify-start gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-white transition-colors cursor-pointer"
                  >
                    <img 
                      src={`https://www.google.com/s2/favicons?domain=${platform.domain}&sz=64`} 
                      alt={platform.name}
                      className="w-6 h-6 rounded-md bg-white p-0.5 object-contain" 
                      loading="lazy"
                    />
                    <span className="font-medium text-[15px]">{platform.name}</span>
                  </a>
                )})}
              </div>
            </div>
          </div>
        </div>
      )}

      {showLanguagePopup && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => {
            if (tempLanguage === null) {
                setLanguage('en');
                if (currentUserId) {
                    localStorage.setItem('website_language', 'en');
                    appendToGoogleSheet({
                        action: "ADD",
                        id: `USER_LANG_${currentUserId}`,
                        userid: currentUserId,
                        text: 'en',
                        timestamp: Date.now(),
                        starred: 0
                    }).catch(e => console.error(e));
                }
            }
            setShowLanguagePopup(false);
        }}>
          <div 
             className="bg-[#111] border border-white/10 p-6 sm:p-8 flex flex-col items-center w-full max-w-sm sm:max-w-md shadow-[0_0_40px_rgba(0,0,0,0.8)] relative rounded-3xl"
             onClick={(e) => e.stopPropagation()}
             dir="ltr"
          >
             <button 
               onClick={() => {
                   if (tempLanguage === null) {
                       setLanguage('en');
                       if (currentUserId) {
                           localStorage.setItem('website_language', 'en');
                           appendToGoogleSheet({
                               action: "ADD",
                               id: `USER_LANG_${currentUserId}`,
                               userid: currentUserId,
                               text: 'en',
                               timestamp: Date.now(),
                               starred: 0
                           }).catch(e => console.error(e));
                       }
                   }
                   setShowLanguagePopup(false);
               }} 
               className="absolute top-4 left-4 p-2 text-gray-500 hover:text-white transition-colors cursor-pointer bg-transparent border-none"
             >
               <X size={24} />
             </button>
             <div className="w-16 h-1 bg-white/20 rounded-full mb-6 mx-auto"></div>
             <div className="text-xl sm:text-2xl text-white font-medium mb-8 text-center pt-2 tracking-wide font-sans">{t('websiteLanguage', displayLang)}</div>
             
             <div className="flex flex-col w-full gap-4">
                 <button onClick={() => {
                   setTempLanguage('en');
                  }} className="w-full py-4 bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl transition-all font-medium text-lg min-h-[60px] active:scale-95 cursor-pointer font-sans tracking-wider flex items-center justify-center relative text-white">
                    {tempLanguage === 'en' && <Check size={22} className="absolute left-6 text-green-400" strokeWidth={2} />}
                    {t('english', displayLang)}
                 </button>
                 <button onClick={() => {
                   setTempLanguage('ar');
                 }} className="w-full py-4 bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl transition-all font-medium text-lg min-h-[60px] active:scale-95 cursor-pointer font-sans tracking-wider flex items-center justify-center relative text-white">
                    {tempLanguage === 'ar' && <Check size={22} className="absolute left-6 text-green-400" strokeWidth={2} />}
                    {t('arabic', displayLang)}
                 </button>

                 {tempLanguage !== null && (
                    <button onClick={() => {
                        setLanguage(tempLanguage);
                        if (currentUserId) {
                             localStorage.setItem('website_language', tempLanguage);
                             appendToGoogleSheet({
                                action: "ADD",
                                id: `USER_LANG_${currentUserId}`,
                                userid: currentUserId,
                                text: tempLanguage,
                                timestamp: Date.now(),
                                starred: 0
                             }).catch(e => console.error(e));
                        }
                        setShowLanguagePopup(false);
                    }} className="w-full mt-2 py-4 bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl transition-all font-medium min-h-[60px] active:scale-95 cursor-pointer flex items-center justify-center text-white">
                        <Check size={28} strokeWidth={2.5} className="text-green-500" />
                    </button>
                 )}
             </div>
          </div>
        </div>
      )}

      {showAndroidInstallModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md px-4" onClick={() => { setShowAndroidInstallModal(false); setShowManualInstructions(false); }}>
          <div 
            className="bg-[#0c0c0c] border border-white/10 p-6 sm:p-8 flex flex-col items-center w-full max-w-sm sm:max-w-md shadow-[0_0_50px_rgba(0,0,0,0.9)] relative rounded-3xl"
            onClick={(e) => e.stopPropagation()}
            dir={displayLang === 'ar' ? 'rtl' : 'ltr'}
          >
            <button 
              onClick={() => { setShowAndroidInstallModal(false); setShowManualInstructions(false); }}
              className="absolute top-4 left-4 p-2 text-gray-500 hover:text-white transition-colors cursor-pointer bg-transparent border-none outline-none"
            >
              <X size={24} />
            </button>

            <div className="w-20 h-20 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mb-6 relative">
              <div className="absolute inset-0 rounded-full bg-green-500/5 animate-ping" />
              <Smartphone size={40} className="text-green-400" strokeWidth={1.5} />
              <div className="absolute bottom-1 right-1 bg-green-500 text-black rounded-full p-1 border-2 border-[#0c0c0c]">
                <Download size={14} strokeWidth={2.5} />
              </div>
            </div>

            <h3 className="text-xl sm:text-2xl font-bold text-white text-center mb-2 font-sans">
              {displayLang === 'ar' ? 'تثبيت التطبيق على أندرويد' : 'Install App on Android'}
            </h3>
            <p className="text-gray-400 text-sm text-center mb-6 max-w-[320px]">
              {displayLang === 'ar' 
                ? 'يدعم التنزيل والتثبيت الفوري لجميع هواتف أندرويد (سامسونج، شاومي، أوبو، ريلمي، وغيرها) بكافة أنواع المتصفحات!' 
                : 'Supports instant download & install for all Android devices (Samsung, Xiaomi, Oppo, Realme, Pixel, etc.) across all browsers!'}
            </p>

            {/* Show manual installation instructions if deferredPrompt is not available, or if the user clicks details */}
            {(!deferredPrompt || showManualInstructions) ? (
              <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 mb-6 text-xs sm:text-sm text-gray-300 leading-relaxed" dir={displayLang === 'ar' ? 'rtl' : 'ltr'}>
                <p className="font-bold text-green-400 mb-3 text-center text-sm">
                  {displayLang === 'ar' ? '💡 طريقة التثبيت السريع على متصفحك الحاصل:' : '💡 Fast Manual Install Instructions:'}
                </p>
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2 items-start">
                    <span className="font-bold text-green-400 min-w-[18px] text-center">1</span>
                    <p>
                      {displayLang === 'ar' 
                        ? 'اضغط على زر القائمة بالمتصفح (علامة السيرش بالمنيو، أو النقاط الثلاثة ⋮ أعلى اليسار، أو زر القائمة ☰ بالأسفل).' 
                        : 'Tap the browser menu/share button (three dots ⋮ at the top right, or ☰ at the bottom).'}
                    </p>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="font-bold text-green-400 min-w-[18px] text-center">2</span>
                    <p>
                      {displayLang === 'ar' 
                        ? 'اختر "تثبيت التطبيق" (Install App) أو "إضافة إلى الشاشة الرئيسية" (Add to Home screen).' 
                        : 'Select "Install app" or "Add to Home screen" option.'}
                    </p>
                  </div>
                  <div className="flex gap-2 items-start">
                    <span className="font-bold text-green-400 min-w-[18px] text-center">3</span>
                    <p>
                      {displayLang === 'ar' 
                        ? 'سيظهر التطبيق كأيقونة على شاشة جوالك مباشرة ليعمل كتطبيق سريع وخفيف بشكل كامل!' 
                        : 'The app icon will instantly appear on your screen and act as a full standalone app!'}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="w-full flex flex-col gap-3">
              {deferredPrompt ? (
                <button 
                  onClick={handleInstallClick}
                  className="w-full py-4 bg-white text-black hover:bg-gray-200 active:scale-95 transition-all text-base sm:text-lg font-bold rounded-2xl flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_20px_rgba(255,255,255,0.15)] outline-none border-none"
                >
                  <Download size={20} strokeWidth={2.5} />
                  {displayLang === 'ar' ? 'تثبيت التطبيق الآن' : 'Install Application Now'}
                </button>
              ) : (
                <button 
                  onClick={() => { setShowAndroidInstallModal(false); setShowManualInstructions(false); }}
                  className="w-full py-4 bg-white text-black hover:bg-gray-200 active:scale-95 transition-all text-base sm:text-lg font-bold rounded-2xl flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_20px_rgba(255,255,255,0.15)] outline-none border-none"
                >
                  <Check size={20} strokeWidth={2.5} />
                  {displayLang === 'ar' ? 'حسناً، فهمت الطريقة' : 'Got it, I understand'}
                </button>
              )}

              <button 
                onClick={() => { setShowAndroidInstallModal(false); setShowManualInstructions(false); }}
                className="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all text-sm font-medium rounded-xl cursor-pointer text-center outline-none border-none"
              >
                {displayLang === 'ar' ? 'تصفح مؤقتاً عبر الويب' : 'Continue on Web'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
