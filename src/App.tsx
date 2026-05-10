/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Eye, EyeOff, Plus, User, Trash2, Pencil, Copy, Check, X, Star, Share2, Mic, Image as ImageIcon, UploadCloud } from 'lucide-react';
import React, { useState, useEffect, useRef, useMemo } from 'react';

const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbyiEns9GDoPmwDTKM7WdmMghaKrB_K_QQ2CBuW__0CyZC2GS-axQOSC0H4WrUoW2A2xPQ/exec";

// Fetch all rows from the Google Sheet
const fetchAllGoogleSheetRows = async () => {
  const res = await fetch(GOOGLE_SHEETS_URL, { method: "GET" });
  if (!res.ok) throw new Error("Failed to fetch Google Sheet");
  const data: any[][] = await res.json();
  return data;
};

// Append a row to the Google Sheet with automatic retries for maximum reliability
const appendToGoogleSheet = async (payload: any, retryCount = 0): Promise<any> => {
  try {
    await fetch(GOOGLE_SHEETS_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      mode: "no-cors"
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

// Keep original image quality
const compressImage = (dataUrl: string): Promise<string> => {
  return Promise.resolve(dataUrl);
};

interface TextItem {
  id: string;
  userId: string;
  text: string;
  timestamp: number;
  starred?: boolean;
  synced?: boolean;
}

const initLocalDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('my-app-db', 2);
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
    };
  });
};

const TAB_ID = Math.random().toString(36).substring(2);
let lastLocalWriteTime = 0;

const notifyTabSync = (userId: string) => {
  try {
    const bc = new BroadcastChannel(`app_sync_${userId}`);
    bc.postMessage({ type: 'sync_local', tabId: TAB_ID });
    bc.close();
  } catch (e) {}
};

const saveTextToDB = async (textItem: TextItem, isUpdate = false) => {
  lastLocalWriteTime = Date.now();
  
  // Initial save to local DB with synced = false
  const itemToSave = { ...textItem, synced: textItem.synced || false };
  
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
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.timestamp - a.timestamp));
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error("Local fetch error", e);
  }
  return texts;
};

const syncTextsFromRemoteDB = async (userId: string, currentPassword?: string): Promise<{ passwordMismatch?: boolean } | void> => {
  try {
    const data = await fetchAllGoogleSheetRows();
    const textsMap = new Map<string, TextItem>();
    const deletedIds = new Set<string>();
    let deleteAllMarkerTime = 0;
    
    let remotePasswordStr: string | null = null;
    let lockoutExpiry = 0;

    // Process items sequentially to always keep the latest version.
    for (const row of data) {
      const rowId = String(row[0]);
      const rowUser = String(row[1]);
      
      if (rowId === userId && rowUser === "USER_AUTH") {
        remotePasswordStr = String(row[2] ?? "").padStart(5, '0');
      } else if (rowId === `${userId}_LOCKOUT` && rowUser === "USER_AUTH_LOCKOUT") {
        lockoutExpiry = Math.max(lockoutExpiry, Number(row[2]));
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
      localStorage.setItem(`verify_lockout_${userId}`, lockoutExpiry.toString());
    }

    if (currentPassword && remotePasswordStr && remotePasswordStr !== currentPassword) {
      return { passwordMismatch: true };
    }

    
    const remoteTexts = Array.from(textsMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    
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
              const req = store.put(t);
              req.onsuccess = () => {
                putCount++;
                checkDone();
              };
              req.onerror = () => reject(req.error);
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
  
  try {
    const localDb = await initLocalDB();
    await new Promise((resolve, reject) => {
      const tx = localDb.transaction('texts', 'readwrite');
      const store = tx.objectStore('texts');
      ids.forEach(id => store.delete(id));
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
      localStorage.setItem(`verify_lockout_${id}`, lockoutExpiry.toString());
      return { isValid: false, error: 'تم الحظر مؤقتا يرجى الانتظار' };
    }

    if (found) {
      userExists = true;
      if (currentPass === pass) {
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
        const remoteTexts = Array.from(textsMap.values()).sort((a, b) => b.timestamp - a.timestamp);
        if (remoteTexts.length > 0) {
          try {
            const localDb = await initLocalDB();
            await new Promise<void>((resolve, reject) => {
              const tx = localDb.transaction('texts', 'readwrite');
              const store = tx.objectStore('texts');
              let putCount = 0;
              remoteTexts.forEach(item => {
                const req = store.put(item);
                req.onsuccess = () => {
                  putCount++;
                  if (putCount === remoteTexts.length) resolve();
                };
                req.onerror = reject;
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
  } catch (e) {
    console.error("Google Sheets login error", e);
    if (validPassword) {
      return { isValid: true };
    }
  }
  
  if (!userExists) {
    return { isValid: false, error: 'لا يوجد المعرف' };
  } else if (!validPassword) {
    return { isValid: false, error: 'كلمة المرور خطا' };
  }
  
  return { isValid: false, error: 'حدث خطأ غير معروف' };
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
  const [currentView, setCurrentView] = useState<'home' | 'signup' | 'login' | 'dashboard'>('home');
  const [isLoggingIn, setIsLoggingIn] = useState(false);


  const [generatedId, setGeneratedId] = useState('');
  const [password, setPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  
  const [loginId, setLoginId] = useState('');
  const [loginIdError, setLoginIdError] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginPasswordError, setLoginPasswordError] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [currentUserId, setCurrentUserId] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');

  useEffect(() => {
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
    localStorage.removeItem('userSession');
    localStorage.setItem('explicitLogout', 'true');
    setCurrentUserId('');
    setCurrentPassword('');
    setCurrentView('home');
    setShowUserIdPopup(false);
    
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
  const [verifyAction, setVerifyAction] = useState<'view' | 'edit'>('view');
  const [texts, setTexts] = useState<TextItem[]>([]);
  const sortedTexts = useMemo(() => {
    return texts.slice().sort((a, b) => {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      return b.timestamp - a.timestamp;
    });
  }, [texts]);
  const pendingCount = useMemo(() => texts.filter(t => t.synced === false).length, [texts]);
  const recentTextAdditionsCount = useMemo(() => {
    return texts.filter(t => !t.text.startsWith('data:image/') && Date.now() - t.timestamp < 24 * 60 * 60 * 1000).length;
  }, [texts]);
  const recentImageAdditionsCount = useMemo(() => {
    return texts.filter(t => t.text.startsWith('data:image/') && Date.now() - t.timestamp < 24 * 60 * 60 * 1000).length;
  }, [texts]);

  const [verifyPasswordInput, setVerifyPasswordInput] = useState('');
  const [verifyError, setVerifyError] = useState(false);
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [showAddTextPopup, setShowAddTextPopup] = useState(false);
  const [showAddImagePopup, setShowAddImagePopup] = useState(false);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
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
      } else {
         setLoginLockoutTimer(0);
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
      alert('عذراً، متصفحك لا يدعم تحويل الصوت إلى نص.');
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
      // إعادة تشغيل المايكروفون تلقائياً إذا لم يوقفه المستخدم يدوياً للحفاظ على الجودة وعدم القص
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
        isSyncing = true;
        try {
          const res = await syncTextsFromRemoteDB(currentUserId, currentPassword);
          if (res && res.passwordMismatch) {
            handleLogout();
            return;
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
    // الحد الأقصى 3 صور فقط
    const targetFiles = files.slice(0, 3 - imagePreviews.length);
    if (targetFiles.length === 0) return;

    let processed = 0;
    const batchSize = 10;
    
    const processBatch = () => {
      const target = targetFiles.slice(processed, processed + batchSize);
      if (target.length === 0) return;

      Promise.all(target.map(file => {
        return new Promise<string>((resolve) => {
          if (!file.type.startsWith('image/')) {
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
    setCurrentView('signup');
  };

  return (
    <div className="min-h-screen w-full bg-black relative flex flex-col items-center justify-center gap-4 text-white" dir="rtl">
      <div className="absolute top-0 left-0 p-4 text-lg text-gray-500 font-sans flex flex-col" dir="ltr">
        <span>Inter Storage</span>
      </div>

      {currentView === 'dashboard' && (
        <button 
          onClick={() => setShowUserIdPopup(true)}
          className="absolute top-4 right-4 p-2 flex items-center justify-center transition-all outline-none cursor-pointer text-gray-400 hover:text-white hover:scale-110 active:scale-95"
          title="الحساب"
        >
          <User size={28} strokeWidth={1.5} />
        </button>
      )}

      {currentView === 'dashboard' && texts.length > 0 && (
        <>
          <div className="absolute top-[73px] left-0 right-0 h-[63px] flex items-center justify-end px-6 gap-4 z-20 pointer-events-none">
            {selectedTexts.size > 0 && (
              <>
                <button
                  onClick={() => {
                    if (selectedTexts.size === texts.length) {
                      setSelectedTexts(new Set());
                    } else {
                      setSelectedTexts(new Set(texts.map(t => t.id)));
                    }
                  }}
                  className="px-4 h-[42px] flex items-center justify-center transition-all outline-none cursor-pointer text-gray-400 hover:text-white rounded-lg border border-gray-600 hover:border-gray-400 active:scale-95 pointer-events-auto bg-transparent"
                >
                  <span className="font-medium text-base m-0 p-0 leading-none flex items-center justify-center h-full h-fit">All</span>
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 h-[42px] flex items-center justify-center gap-2 transition-all outline-none cursor-pointer text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg active:scale-95 pointer-events-auto bg-transparent border border-transparent"
                >
                  <span className="font-semibold m-0 p-0 leading-none flex items-center justify-center h-full h-fit text-lg">{selectedTexts.size}</span>
                  <Trash2 size={24} strokeWidth={1.5} className="flex-shrink-0" />
                </button>
              </>
            )}
            <div className="flex items-center gap-1 pointer-events-auto">
              <span className="text-white/30 text-base font-medium px-1" title="عدد النصوص المضافة اليوم">
                {recentTextAdditionsCount > 0 ? recentTextAdditionsCount : ''}
              </span>
              <button 
                onClick={() => { setShowAddTextPopup(true); setNewText(''); }}
                className="p-2 flex items-center justify-center transition-all outline-none cursor-pointer text-gray-400 hover:text-white hover:scale-110 active:scale-95"
                title="إضافة نص"
              >
                <Plus size={28} strokeWidth={1.5} />
              </button>
              <span className="text-white/30 text-base font-medium pl-1 pr-3" title="عدد الصور المضافة اليوم">
                {recentImageAdditionsCount > 0 ? recentImageAdditionsCount : ''}
              </span>
              <button 
                onClick={() => {
                  if (imageCooldownRemaining > 0) return;
                  setShowAddImagePopup(true); 
                  setImagePreviews([]); 
                }}
                disabled={imageCooldownRemaining > 0}
                className={`p-2 flex items-center justify-center transition-all outline-none ${imageCooldownRemaining > 0 ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:scale-110 active:scale-95 cursor-pointer'}`}
                title={imageCooldownRemaining > 0 ? `انتظر ${imageCooldownRemaining} ثواني` : "إضافة صورة"}
              >
                {imageCooldownRemaining > 0 ? (
                  <span className="text-sm font-medium w-[26px] h-[26px] flex items-center justify-center bg-white/10 rounded-full">{imageCooldownRemaining}</span>
                ) : (
                  <ImageIcon size={26} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>
          <div className="absolute top-[136px] left-0 right-0 h-[1px] bg-white/10 w-full z-10 pointer-events-none" />
        </>
      )}

      {/* Header separator */}
      <div className="absolute top-[72px] left-0 right-0 h-[1px] bg-white/10 w-full z-10 pointer-events-none" />

      {currentView === 'home' && (
        <>
          <button onClick={() => { setLoginId(''); setLoginPassword(''); setCurrentView('login'); }} className="cursor-pointer w-56 bg-transparent hover:bg-white/10 text-white font-medium py-2 px-8 rounded-full border border-gray-500 hover:border-white transition-all hover:scale-105 active:scale-95 text-lg tracking-wide">
            تسجيل دخول
          </button>
          <button onClick={handleGoToSignup} className="cursor-pointer w-56 bg-white hover:bg-gray-100 text-black font-medium py-2 px-8 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all hover:scale-105 active:scale-95 text-lg tracking-wide">
            انشاء حساب
          </button>
        </>
      )}

      {currentView === 'signup' && (
        <div className="flex flex-col items-center gap-8 w-full max-w-sm px-6 pt-24">
          <div className="absolute top-[80px] text-xl font-light tracking-wide text-white text-center">انشاء حساب</div>
          <div className="flex flex-col gap-3 w-full">
            <label className="text-gray-400 text-sm">المعرف الخاص بك <span className="text-gray-500 text-xs">(تم إنشاؤه تلقائياً)</span></label>
            <div className="flex items-center gap-2 w-full">
              <div className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-center text-2xl font-mono tracking-[0.5em] text-white">
                {generatedId}
              </div>
              <button 
                onClick={(e) => handleCopyId(generatedId, e)}
                className="shrink-0 p-3 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors h-[56px] flex items-center justify-center cursor-pointer"
                title="نسخ المعرف"
              >
                {copiedId === generatedId ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
              </button>
            </div>
            <p className="text-xs text-gray-500">هذا المعرف سيكون مطلوباً لتسجيل الدخول لاحقاً.</p>
          </div>

          <div className="flex flex-col gap-3 w-full">
            <label className="text-gray-400 text-sm">الرقم السري (5 أرقام)</label>
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
                setCurrentView('dashboard');
              }}
              disabled={password.length !== 5}
              className={`w-full font-medium py-3 px-8 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all text-lg tracking-wide ${password.length === 5 ? 'bg-white hover:bg-gray-100 text-black cursor-pointer hover:scale-105 active:scale-95' : 'bg-white/50 text-gray-800 cursor-not-allowed'}`}
            >
              انشاء الحساب
            </button>

            <button 
              onClick={() => setCurrentView('home')} 
              className="cursor-pointer w-full text-gray-500 hover:text-white transition-colors py-2 text-sm font-light mt-2"
            >
              العودة
            </button>
          </div>
        </div>
      )}

      {currentView === 'login' && (
        <div className="flex flex-col items-center gap-8 w-full max-w-sm px-6 pt-24">
          <div className="absolute top-[80px] text-xl font-light tracking-wide text-white text-center">تسجيل الدخول</div>
          
          <div className="flex flex-col gap-3 w-full">
            <label className="text-gray-400 text-sm">المعرف الخاص بك</label>
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
            <label className="text-gray-400 text-sm">الرقم السري</label>
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
          </div>

          <div className="flex flex-col w-full gap-3 mt-4">
            <button 
              onClick={() => {
                if (isLoggingIn || loginLockoutTimer > 0) return;
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
                       result = { isValid: false, error: 'كلمة المرور خطا' };
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
                    if (result.error === 'لا يوجد المعرف') {
                      setLoginIdError('عذرا هذا المعرف غير موجود');
                    } else if (result.error === 'كلمة المرور خطا') {
                      const attemptsStr = localStorage.getItem(`login_attempts_${loginId}`);
                      let attempts = attemptsStr ? parseInt(attemptsStr) : 0;
                      attempts += 1;
                      if (attempts >= 5) {
                        const expiry = Date.now() + 300000;
                        localStorage.setItem(`login_lockout_${loginId}`, expiry.toString());
                        localStorage.setItem(`login_attempts_${loginId}`, "0");
                        setLoginLockoutTimer(300);
                        setLoginPasswordError('تم الحظر مؤقتا يرجى الانتظار');
                        appendToGoogleSheet({
                          action: "ADD",
                          id: `${loginId}_LOCKOUT`,
                          userid: "USER_AUTH_LOCKOUT",
                          text: expiry.toString(),
                          timestamp: Date.now(),
                          starred: 0
                        }).catch(e => console.error(e));
                      } else {
                        localStorage.setItem(`login_attempts_${loginId}`, attempts.toString());
                        setLoginPasswordError(`عذرا كلمة المرور خاطئة (يتبقى ${5 - attempts} محاولات)`);
                      }
                    } else {
                      alert(result.error);
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
                <span className="text-lg">انتظر {loginLockoutTimer} ثانية</span>
              ) : (
                <span className="text-lg">دخول</span>
              )}
            </button>

            <button 
              onClick={() => setCurrentView('home')} 
              className="cursor-pointer w-full text-gray-500 hover:text-white transition-colors py-2 text-sm font-light mt-2"
            >
              العودة
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
            <span className="text-lg text-gray-400 group-hover:text-white transition-colors font-light tracking-wide">إضافة نص</span>
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
              {imageCooldownRemaining > 0 ? `انتظر ${imageCooldownRemaining} ثواني` : 'إضافة صورة'}
            </span>
          </button>
        </div>
      )}

      {currentView === 'dashboard' && texts.length > 0 && (
        <div className="absolute inset-0 pt-[156px] px-6 flex flex-col items-start pointer-events-none pb-6 w-full h-full overflow-hidden" dir="ltr">
          {/* Texts list */}
          <div className="flex-1 w-full pointer-events-auto overflow-y-auto custom-scrollbar" dir="rtl">
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 pb-12 w-full items-start" dir="ltr">
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
                          className={`p-1.5 transition-all cursor-pointer outline-none bg-transparent border-none ${item.starred ? 'opacity-100 text-yellow-500 hover:text-yellow-400' : 'opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white'}`}
                          title={item.starred ? "إزالة التمييز" : "تثبيت كمفضلة"}
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
                            className="p-1.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-transparent text-gray-400 hover:text-white"
                            title="تعديل النص"
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
                          className="p-1.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-transparent text-gray-400 hover:text-white"
                          title="مشاركة"
                        >
                          <Share2 size={18} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={(e) => handleCopy(item.text, item.id, e)}
                          className="p-1.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-transparent text-gray-400 hover:text-white"
                          title="نسخ"
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
                              المزيد
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
                              عرض أقل
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
                                عرض الكل
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
                              عرض أقل شيء
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
            <div className="text-xl text-gray-300 font-light mt-2">المعرف الخاص بك</div>
            <div className="flex items-center gap-2 w-full">
              <div className="bg-black border border-white/5 rounded-2xl py-3 px-4 text-center text-3xl font-mono tracking-[0.5em] text-white w-full" dir="ltr">
                {currentUserId}
              </div>
              <button 
                onClick={(e) => handleCopyId(currentUserId, e)}
                className="shrink-0 p-3 bg-black border border-white/5 hover:border-white/20 rounded-2xl text-gray-400 hover:text-white transition-colors h-[64px] flex items-center justify-center cursor-pointer"
                title="نسخ المعرف"
              >
                {copiedId === currentUserId ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
              </button>
            </div>

            <div className="w-full flex flex-col gap-3">
              <div className="flex items-center justify-between w-full">
                <div className="text-right text-gray-400 text-sm">كلمة المرور</div>
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
                    إلغاء
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
                    حفظ
                  </button>
                </div>
              )}

              {showVerifyPassword && !showUserIdPassword && !isEditingPassword && (
                <div className="flex flex-col gap-2 mt-2 animate-in fade-in duration-200">
                  <div className="text-right text-gray-400 text-xs">
                    {verifyAction === 'edit' ? 'يرجى تأكيد كلمة المرور الحالية للتعديل' : 'يرجى تأكيد كلمة المرور لعرضها'}
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
                        if (verifyPasswordInput === currentPassword) {
                          localStorage.removeItem(`verify_attempts_${currentUserId}`);
                          localStorage.removeItem(`verify_lockout_${currentUserId}`);
                          if (verifyAction === 'view') {
                            setShowUserIdPassword(true);
                          } else if (verifyAction === 'edit') {
                            setIsEditingPassword(true);
                            setNewPasswordValue(currentPassword);
                            setShowNewPassword(false);
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
                            setVerifyErrorMsg('تم الحظر مؤقتا يرجى الانتظار');
                            appendToGoogleSheet({
                              action: "ADD",
                              id: `${currentUserId}_LOCKOUT`,
                              userid: "USER_AUTH_LOCKOUT",
                              text: expiry.toString(),
                              timestamp: Date.now(),
                              starred: 0
                            }).catch(e => console.error(e));
                          } else {
                            localStorage.setItem(`verify_attempts_${currentUserId}`, attempts.toString());
                            setVerifyErrorMsg(`كلمة المرور خاطئة (يتبقى ${5 - attempts} محاولات)`);
                          }
                          setVerifyPasswordInput('');
                          setVerifyError(true);
                        }
                      }}
                      disabled={verifyLockoutTimer > 0}
                      className={`bg-transparent px-3 text-sm font-medium transition-colors outline-none ${verifyLockoutTimer > 0 ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white cursor-pointer'}`}
                    >
                      {verifyLockoutTimer > 0 ? 'محظور' : 'تأكيد'}
                    </button>
                  </div>
                  {(verifyError || verifyLockoutTimer > 0) && (
                    <div className="text-red-400 text-xs text-right animate-in fade-in zoom-in-95 duration-200">
                      {verifyLockoutTimer > 0 ? `يرجى الانتظار ${verifyLockoutTimer} ثانية` : verifyErrorMsg || 'كلمة المرور خاطئة'}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 mt-4 w-full">
              <button 
                id="logout-btn"
                onClick={() => setShowLogoutConfirm(true)} 
                className="w-full cursor-pointer bg-transparent text-red-500 hover:text-red-400 font-medium py-2 transition-all hover:scale-105 active:scale-95 text-base border-none outline-none mt-2"
              >
                تسجيل الخروج
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
              <div className="text-xl text-gray-300 font-medium">إضافة صور</div>
              <button 
                onClick={() => { setShowAddImagePopup(false); setImagePreviews([]); }}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer text-base bg-transparent border-none outline-none"
              >
                إلغاء
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
                accept="image/*" 
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
                    className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black text-white rounded-full transition-colors opacity-0 group-hover:opacity-100 z-10"
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
                    input.accept = 'image/*';
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
                  <span className="text-gray-400 font-light">أرفق صوراً أو اسحبها هنا</span>
                </>
              )}
            </div>
            
            <div className="flex justify-between items-center w-full mt-2" dir="rtl">
              <div className="text-sm text-gray-500">تم اختيار {imagePreviews.length} صور</div>
              <button 
                onClick={async () => {
                  if (imagePreviews.length === 0) return;
                  
                  // Show loading feedback
                  const btn = document.getElementById('add-all-btn') as HTMLButtonElement;
                  if (btn) {
                    btn.disabled = true;
                    btn.textContent = 'جاري الرفع...';
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
                إضافة الكل
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
              <div className="text-xl text-gray-300 font-medium">إضافة نص جديد</div>
              <button 
                onClick={() => { setShowAddTextPopup(false); stopRecordingUserAction(); }}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer text-base bg-transparent border-none outline-none"
              >
                إلغاء
              </button>
            </div>
            <div className="w-full h-48 bg-white/5 border border-white/10 rounded-2xl flex flex-row focus-within:border-white/30 transition-colors" dir="rtl">
              <textarea
                value={newText}
                onChange={(e) => {
                  setNewText(e.target.value);
                  recordingTextRef.current = e.target.value;
                }}
                placeholder="اكتب نصك"
                className="flex-1 bg-transparent p-4 text-white placeholder:text-gray-600 focus:outline-none resize-none text-lg leading-relaxed custom-scrollbar h-full"
                dir="rtl"
              />
              <div className="w-14 border-r border-white/10 flex items-end justify-center pb-3 flex-shrink-0">
                <button
                  type="button"
                  className={`p-2 rounded-full transition-all duration-300 flex items-center justify-center ${isRecording ? 'bg-red-500/30 text-red-500 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.6)] scale-110' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'}`}
                  onClick={() => toggleRecording(setNewText, newText)}
                  title="تحدث"
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
                          text: chunkText + `\n\n(جزء ${i + 1} من ${numChunks})`,
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
                إضافة
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
              تأكيد عملية الحذف
            </div>
            <div className="text-gray-400 text-center text-sm leading-relaxed" dir="rtl">
              هل أنت متأكد من حذف المحدد وهو {selectedTexts.size}؟ لا يمكن التراجع عن هذه العملية.
            </div>
            <div className="flex gap-4 w-full mt-2">
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-full transition-all active:scale-95 text-lg"
              >
                إلغاء
              </button>
              <button 
                onClick={deleteSelectedTexts}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-medium py-3 rounded-full transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)] active:scale-95 text-lg"
              >
                حذف
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
              <div className="text-xl text-gray-300 font-medium">تعديل النص</div>
              <button 
                onClick={() => {
                  setShowEditTextPopup(false);
                  stopRecordingUserAction();
                  setEditTextItem(null);
                  setEditTextInput('');
                }}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer text-base bg-transparent border-none outline-none"
              >
                إلغاء
              </button>
            </div>
            <div className="w-full h-48 bg-white/5 border border-white/10 rounded-2xl flex flex-row focus-within:border-white/30 transition-colors" dir="rtl">
              <textarea
                value={editTextInput}
                onChange={(e) => {
                  setEditTextInput(e.target.value);
                  recordingTextRef.current = e.target.value;
                }}
                placeholder="اكتب تعديلك هنا..."
                className="flex-1 bg-transparent p-4 text-white placeholder:text-gray-600 focus:outline-none resize-none text-lg leading-relaxed custom-scrollbar h-full"
                dir="rtl"
              />
              <div className="w-14 border-r border-white/10 flex items-end justify-center pb-3 flex-shrink-0">
                <button
                  type="button"
                  className={`p-2 rounded-full transition-all duration-300 flex items-center justify-center ${isRecording ? 'bg-red-500/30 text-red-500 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.6)] scale-110' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'}`}
                  onClick={() => toggleRecording(setEditTextInput, editTextInput)}
                  title="تحدث"
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
                          text: chunkText + `\n\n(جزء ${i + 1} من ${numChunks})`,
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
                تعديل
              </button>
            </div>
          </div>
        </div>
      )}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setShowLogoutConfirm(false)}>
          <div 
             className="bg-[#111] border border-white/10 p-6 rounded-3xl flex flex-col gap-6 w-full max-w-sm shadow-[0_0_40px_rgba(0,0,0,0.8)] relative text-center"
             onClick={(e) => e.stopPropagation()}
             dir="rtl"
          >
            <div className="text-xl text-white font-medium">هل أنت متأكد أنك تريد تسجيل الخروج؟</div>
            <div className="flex gap-4 w-full">
              <button 
                onClick={() => setShowLogoutConfirm(false)} 
                className="flex-1 cursor-pointer bg-white/10 hover:bg-white/20 text-white font-medium py-3 rounded-full transition-all hover:scale-105 active:scale-95 text-lg"
              >
                لا
              </button>
              <button 
                onClick={() => {
                  setShowLogoutConfirm(false);
                  handleLogout();
                }} 
                className="flex-1 cursor-pointer bg-red-500 hover:bg-red-600 text-white font-medium py-3 rounded-full transition-all hover:scale-105 active:scale-95 text-lg"
              >
                نعم
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
                         <img src={viewedItem.text} alt="عرض الصورة" className="w-full h-auto max-h-[70vh] object-contain rounded-xl" />
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
                     <span className="text-sm font-medium">نسخ</span>
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
                     <span className="text-sm font-medium">مشاركة</span>
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
                     title={(texts.find(t => t.id === viewedItem.id)?.starred || viewedItem.starred) ? "إزالة التمييز" : "تثبيت كمفضلة"}
                 >
                     <Star size={20} className={(texts.find(t => t.id === viewedItem.id)?.starred || viewedItem.starred) ? "fill-yellow-500" : ""} />
                     <span className="text-sm font-medium">تمييز</span>
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
              <div className="text-xl text-white font-medium">مشاركة عبر</div>
              <button 
                onClick={() => setShareModalText(null)}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer bg-transparent border-none outline-none"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              <div className="text-sm text-green-400 mb-6 font-medium text-center bg-green-400/10 py-3 rounded-xl">
                {shareModalText?.startsWith('data:image/') ? 'تم نسخ الصورة بنجاح!' : 'تم نسخ النص بنجاح!'}
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
                              alert('جهازك لا يدعم مشاركة الملفات مباشرة.');
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
                  <span className="font-medium">مشاركة عبر تطبيقات الجهاز</span>
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
                          alert('تم نسخ الصورة بنجاح! يتم الآن فتح المنصة لتتمكن من لصقها.');
                      } else {
                          navigator.clipboard.writeText(shareModalText || '');
                          alert('تم نسخ النص بنجاح! يتم الآن فتح المنصة لتتمكن من لصقه.');
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

    </div>
  );
}
