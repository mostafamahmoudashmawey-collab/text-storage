/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Eye, EyeOff, Plus, User, Trash2, Pencil, Copy, Check, X, Star, Share2, Mic } from 'lucide-react';
import React, { useState, useEffect, useRef, useMemo } from 'react';
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbyiEns9GDoPmwDTKM7WdmMghaKrB_K_QQ2CBuW__0CyZC2GS-axQOSC0H4WrUoW2A2xPQ/exec";

// Fetch all rows from the Google Sheet
const fetchAllGoogleSheetRows = async () => {
  const res = await fetch(GOOGLE_SHEETS_URL, { method: "GET" });
  if (!res.ok) throw new Error("Failed to fetch Google Sheet");
  const data: any[][] = await res.json();
  return data;
};

// Append a row to the Google Sheet
const appendToGoogleSheet = async (payload: any) => {
  const res = await fetch(GOOGLE_SHEETS_URL, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "text/plain" }
  });
  if (!res.ok) throw new Error("Failed to append to Google Sheet");
  return await res.json();
};


interface TextItem {
  id: string;
  userId: string;
  text: string;
  timestamp: number;
  starred?: boolean;
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

const saveTextToDB = async (textItem: TextItem, isUpdate = false) => {
  try {
    const localDb = await initLocalDB();
    await new Promise((resolve, reject) => {
      const tx = localDb.transaction('texts', 'readwrite');
      const store = tx.objectStore('texts');
      const req = store.put(textItem);
      req.onsuccess = resolve;
      req.onerror = reject;
    });
  } catch (e) {
    console.error("Local save error", e);
  }

  try {
    await appendToGoogleSheet({
      action: isUpdate ? "UPDATE" : "ADD",
      id: textItem.id,
      userid: textItem.userId,
      text: textItem.text,
      timestamp: textItem.timestamp,
      starred: textItem.starred ? 1 : 0
    });
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

const syncTextsFromRemoteDB = async (userId: string) => {
  try {
    const data = await fetchAllGoogleSheetRows();
    const textsMap = new Map<string, TextItem>();
    
    // Process items sequentially to always keep the latest version.
    // Format: [id, userid, text, timestamp, starred]
    for (const row of data) {
      if (String(row[1]) === String(userId) || String(row[1]) === "DELETED") {
        if (Number(row[4]) === -1 || String(row[2]) === "[[DELETED]]" || String(row[1]) === "DELETED") {
            textsMap.delete(String(row[0]));
        } else if (String(row[1]) === String(userId)) {
            textsMap.set(String(row[0]), {
                id: String(row[0]),
                userId: String(row[1]),
                text: String(row[2]),
                timestamp: Number(row[3]),
                starred: Number(row[4]) === 1
            });
        }
      }
    }
    
    const texts = Array.from(textsMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    
    if (texts.length > 0) {
      try {
        const localDb = await initLocalDB();
        await new Promise<void>((resolve, reject) => {
          const tx = localDb.transaction('texts', 'readwrite');
          const store = tx.objectStore('texts');
          
          let putCount = 0;
          texts.forEach(t => {
            const req = store.put(t);
            req.onsuccess = () => {
              putCount++;
              if (putCount === texts.length) resolve();
            };
            req.onerror = () => reject(req.error);
          });
          if (texts.length === 0) resolve();
        });
      } catch (localErr) {
        console.error("Failed to save remote texts to local DB", localErr);
      }
    }
  } catch (e) {
    console.error("Google Sheets fetch error", e);
  }
};

const deleteTextsFromDB = async (ids: string[]) => {
  if (ids.length === 0) return true;
  
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

  try {
    for (const id of ids) {
       await appendToGoogleSheet({
           action: "DELETE",
           id,
           userid: "DELETED", // just as extra measure
           text: "[[DELETED]]",
           timestamp: Date.now(),
           starred: -1
       });
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

const loginUser = async (id: string, pass: string): Promise<{isValid: boolean; error?: string}> => {
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

  if (validPassword) {
    return { isValid: true };
  }

  try {
    const data = await fetchAllGoogleSheetRows();
    let currentPass = null;
    let found = false;
    for (const row of data) {
      if (String(row[0]) === String(id) && row[1] === "USER_AUTH") {
        found = true;
        currentPass = String(row[2] ?? "").padStart(5, '0'); // pad left with zeros safely
      }
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
      }
    }
  } catch (e) {
    console.error("Google Sheets login error", e);
  }
  
  if (validPassword) {
    return { isValid: true };
  } else if (!userExists) {
    return { isValid: false, error: 'لا يوجد المعرف' };
  } else {
    return { isValid: false, error: 'كلمة المرور خطا' };
  }
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
  const [loadingMessage, setLoadingMessage] = useState('');
  const [loadingCount, setLoadingCount] = useState(5);
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);

  const runWithLoader = async (promiseFn: () => Promise<any>, customMessage?: string) => {
    setLoadingMessage(customMessage || 'جاري التحميل...');
    setLoadingCount(5);
    setIsGlobalLoading(true);
    
    let currentCount = 5;
    const interval = setInterval(() => {
      currentCount--;
      if (currentCount >= 0) {
         setLoadingCount(currentCount);
      }
    }, 1000);

    const minWait = new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      await Promise.all([promiseFn(), minWait]);
    } catch (e) {
      console.error(e);
    } finally {
      clearInterval(interval);
      setIsGlobalLoading(false);
    }
  };

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
    }
  }, []);

  const saveSession = (id: string, pass: string) => {
    localStorage.setItem('userSession', JSON.stringify({ id, password: pass }));
  };

  const handleLogout = () => {
    localStorage.removeItem('userSession');
    setCurrentUserId('');
    setCurrentPassword('');
    setCurrentView('home');
    setShowUserIdPopup(false);
  };

  const [showUserIdPopup, setShowUserIdPopup] = useState(false);
  const [showUserIdPassword, setShowUserIdPassword] = useState(false);
  const [showVerifyPassword, setShowVerifyPassword] = useState(false);
  const [verifyAction, setVerifyAction] = useState<'view' | 'edit'>('view');
  const [verifyPasswordInput, setVerifyPasswordInput] = useState('');
  const [verifyError, setVerifyError] = useState(false);
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [showAddTextPopup, setShowAddTextPopup] = useState(false);
  const [showEditTextPopup, setShowEditTextPopup] = useState(false);
  const [editTextItem, setEditTextItem] = useState<TextItem | null>(null);
  const [showLimitPopup, setShowLimitPopup] = useState(false);
  const [showRateLimitPopup, setShowRateLimitPopup] = useState(false);
  const [showEditLimitPopup, setShowEditLimitPopup] = useState(false);
  const [showPasswordEditLimitPopup, setShowPasswordEditLimitPopup] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newText, setNewText] = useState('');
  const [editTextInput, setEditTextInput] = useState('');
  
  const [texts, setTexts] = useState<TextItem[]>([]);
  const sortedTexts = useMemo(() => {
    return texts.slice().sort((a, b) => {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      return b.timestamp - a.timestamp;
    });
  }, [texts]);
  const recentAdditionsCount = useMemo(() => {
    return texts.filter(t => Date.now() - t.timestamp < 24 * 60 * 60 * 1000).length;
  }, [texts]);
  const [expandedLengths, setExpandedLengths] = useState<Record<string, number>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [shareModalText, setShareModalText] = useState<string | null>(null);
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

  const handleCopyId = (id: string, e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
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
    runWithLoader(async () => {
      const idsToDelete = Array.from(selectedTexts) as string[];
      await deleteTextsFromDB(idsToDelete);
      setTexts(prev => prev.filter(t => !selectedTexts.has(t.id)));
      setSelectedTexts(new Set());
      setShowDeleteConfirm(false);
    }, "جاري الحذف...");
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
        await saveTextToDB(newItem);
        setTexts((prev) => [newItem, ...prev]);
        return newItem.id;
      },
      deleteText: async (id: string) => {
        if (!currentUserId) return;
        await deleteTextsFromDB([id]);
        setTexts((prev) => prev.filter((t) => t.id !== id));
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
    if (currentView === 'dashboard' && currentUserId) {
      runWithLoader(async () => {
        const loadedTexts = await getTextsFromLocalDB(currentUserId);
        setTexts(loadedTexts);
        await syncTextsFromRemoteDB(currentUserId);
        const syncedTexts = await getTextsFromLocalDB(currentUserId);
        setTexts(syncedTexts);
      }, "جاري المزامنة...");
    }
  }, [currentView, currentUserId]);

  const generateUniqueId = async () => {
    let unique = false;
    let id = '';
    while (!unique) {
      id = Math.floor(10000 + Math.random() * 90000).toString();
      try {
        const data = await fetchAllGoogleSheetRows();
        let found = false;
        for (const row of data) {
           if (String(row[0]) === String(id) && row[1] === "USER_AUTH") {
             found = true;
             break;
           }
        }
        if (!found) {
          unique = true;
        }
      } catch (e) {
        // If there's a DB error, we assume it's unique mostly (e.g. offline)
        // registerUser will handle any actual failure later.
        unique = true;
      }
    }
    return id;
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
            <div className="flex items-center gap-2 pointer-events-auto">
              <span className="text-gray-500 text-sm font-medium px-2" title="عدد الإضافات اليوم">{recentAdditionsCount}</span>
              <button 
                onClick={() => { setShowAddTextPopup(true); setNewText(''); }}
                className="p-2 -mr-2 flex items-center justify-center transition-all outline-none cursor-pointer text-gray-400 hover:text-white hover:scale-110 active:scale-95"
              >
                <Plus size={28} strokeWidth={1.5} />
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
                runWithLoader(async () => {
                  const success = await registerUser(generatedId, password);
                  if (success) {
                    setCurrentUserId(generatedId);
                    setCurrentPassword(password);
                    saveSession(generatedId, password);
                    setCurrentView('dashboard');
                  } else {
                    alert('حدث خطأ أثناء الإنشاء. ربما المعرف مستخدم. حاول مرة أخرى.');
                  }
                }, "جاري إنشاء الحساب...");
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
                runWithLoader(async () => {
                  setLoginIdError('');
                  setLoginPasswordError('');
                  const result = await loginUser(loginId, loginPassword);
                  if (result.isValid) {
                    await syncTextsFromRemoteDB(loginId);
                    setCurrentUserId(loginId);
                    setCurrentPassword(loginPassword);
                    saveSession(loginId, loginPassword);
                    setCurrentView('dashboard');
                  } else {
                    if (result.error === 'لا يوجد المعرف') {
                      setLoginIdError('عذرا هذا المعرف غير موجود');
                    } else if (result.error === 'كلمة المرور خطا') {
                      setLoginPasswordError('عذرا كلمة المرور خاطئة');
                    } else {
                      alert(result.error);
                    }
                  }
                }, "جاري تسجيل الدخول...");
              }}
              disabled={loginId.length !== 5 || loginPassword.length !== 5}
              className={`w-full font-medium py-3 px-8 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all text-lg tracking-wide ${loginId.length === 5 && loginPassword.length === 5 ? 'bg-white hover:bg-gray-100 text-black cursor-pointer hover:scale-105 active:scale-95' : 'bg-transparent border border-gray-600 text-gray-500 cursor-not-allowed'}`}
            >
              دخول
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
        <button 
          onClick={() => { setShowAddTextPopup(true); setNewText(''); }}
          className="flex flex-col items-center justify-center gap-4 transition-all cursor-pointer group hover:scale-105 active:scale-95 outline-none bg-transparent border-none mt-12"
        >
          <Plus size={48} strokeWidth={1} className="text-gray-400 group-hover:text-white transition-colors" />
          <span className="text-lg text-gray-400 group-hover:text-white transition-colors font-light tracking-wide">إضافة نص</span>
        </button>
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
                      }
                    }}
                    className={`bg-white/5 border ${borderClass} rounded-2xl p-5 pb-10 text-white whitespace-pre-wrap text-[17px] leading-relaxed w-full break-words text-right relative transition-all ${selectedTexts.size > 0 ? 'cursor-pointer' : ''} select-none group`} 
                    dir="rtl"
                  >
                    {!selectedTexts.size && (
                      <div className="absolute bottom-3 left-3 flex flex-row items-center gap-1 z-10" dir="ltr">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const updatedItem = { ...item, starred: !item.starred };
                            await saveTextToDB(updatedItem, true);
                            setTexts(prev => prev.map(t => t.id === item.id ? updatedItem : t));
                          }}
                          className={`p-1.5 transition-all rounded-full cursor-pointer outline-none bg-transparent border-none ${item.starred ? 'opacity-100 text-yellow-500 hover:text-yellow-400' : 'opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white hover:bg-white/10'}`}
                          title={item.starred ? "إزالة التمييز" : "تثبيت كمفضلة"}
                        >
                          <Star size={22} strokeWidth={item.starred ? 2 : 1.5} className={item.starred ? "fill-yellow-500" : ""} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const editHistoryKey = `editHistory_${currentUserId}`;
                            const storedHistory = localStorage.getItem(editHistoryKey);
                            const editTimestamps: number[] = storedHistory ? JSON.parse(storedHistory) : [];
                            const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
                            const recentEdits = editTimestamps.filter(ts => Date.now() - ts < THIRTY_DAYS_MS);
                            
                            if (recentEdits.length >= 100) {
                              setShowEditLimitPopup(true);
                              return;
                            }
                            
                            setEditTextItem(item);
                            setEditTextInput(item.text);
                            setShowEditTextPopup(true);
                          }}
                          className="p-1.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-black/40 hover:bg-black/80 rounded-full text-gray-400 hover:text-white"
                          title="تعديل النص"
                        >
                          <Pencil size={18} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            navigator.clipboard.writeText(item.text);
                            setShareModalText(item.text);
                          }}
                          className="p-1.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-black/40 hover:bg-black/80 rounded-full text-gray-400 hover:text-white"
                          title="مشاركة"
                        >
                          <Share2 size={18} strokeWidth={1.5} />
                        </button>
                      </div>
                    )}
                    {displayText}
                    {isLong && (
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
                      const pwdEditHistoryKey = `passwordEditHistory_${currentUserId}`;
                      const storedHistory = localStorage.getItem(pwdEditHistoryKey);
                      const pwdEditTimestamps: number[] = storedHistory ? JSON.parse(storedHistory) : [];
                      const SEVEN_DAYS_MS = 168 * 60 * 60 * 1000;
                      const recentPwdEdits = pwdEditTimestamps.filter(ts => Date.now() - ts < SEVEN_DAYS_MS);
                      if (recentPwdEdits.length >= 3) {
                        setShowPasswordEditLimitPopup(true);
                        return;
                      }

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
                      runWithLoader(async () => {
                        if (newPasswordValue.length === 5) {
                          await updatePasswordInDB(currentUserId, newPasswordValue);
                          setCurrentPassword(newPasswordValue);
                          saveSession(currentUserId, newPasswordValue);
                          // Also update password and loginPassword if needed matching the current user logic
                          setPassword(newPasswordValue);
                          setLoginPassword(newPasswordValue);

                          const pwdEditHistoryKey = `passwordEditHistory_${currentUserId}`;
                          const storedHistory = localStorage.getItem(pwdEditHistoryKey);
                          const pwdEditTimestamps: number[] = storedHistory ? JSON.parse(storedHistory) : [];
                          const SEVEN_DAYS_MS = 168 * 60 * 60 * 1000;
                          const recentPwdEdits = pwdEditTimestamps.filter(ts => Date.now() - ts < SEVEN_DAYS_MS);
                          recentPwdEdits.push(Date.now());
                          localStorage.setItem(pwdEditHistoryKey, JSON.stringify(recentPwdEdits));

                          setIsEditingPassword(false);
                          setShowUserIdPassword(true);
                        }
                      }, "جاري تغيير كلمة المرور...");
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
                      onChange={(e) => {
                        setVerifyPasswordInput(e.target.value.replace(/[^0-9]/g, ''));
                        setVerifyError(false);
                      }}
                      maxLength={5}
                      className={`flex-1 bg-white/5 border rounded-xl p-3 text-center text-xl tracking-[0.5em] text-white focus:outline-none transition-colors font-mono ${verifyError ? 'border-red-500/50 focus:border-red-500' : 'border-white/20 focus:border-white'}`}
                      placeholder="•••••"
                      dir="ltr"
                      autoFocus
                    />
                    <button 
                      onClick={() => {
                        if (verifyPasswordInput === currentPassword) {
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
                        } else {
                          setVerifyPasswordInput('');
                          setVerifyError(true);
                        }
                      }}
                      className="bg-transparent text-gray-400 hover:text-white px-3 text-sm font-medium cursor-pointer transition-colors outline-none"
                    >
                      تأكيد
                    </button>
                  </div>
                  {verifyError && (
                    <div className="text-red-400 text-xs text-right animate-in fade-in zoom-in-95 duration-200">
                      كلمة المرور خاطئة
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
                  
                  const currentWords = texts.reduce((count, item) => {
                    const textContent = item.text.trim();
                    return count + (textContent ? textContent.split(/\s+/).length : 0);
                  }, 0);
                  const newWords = newText.trim().split(/\s+/).length;
                  
                  if (currentWords + newWords > 10000) {
                    setShowLimitPopup(true);
                    return;
                  }

                  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
                  const recentAdditionsCount = texts.filter(t => Date.now() - t.timestamp < ONE_DAY_MS).length;
                  
                  if (recentAdditionsCount >= 50) {
                    setShowRateLimitPopup(true);
                    return;
                  }

                  runWithLoader(async () => {
                    const newItem: TextItem = {
                      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
                      userId: currentUserId,
                      text: newText.trim(),
                      timestamp: Date.now()
                    };
                    await saveTextToDB(newItem);
                    setTexts((prev) => [newItem, ...prev]);
                    setShowAddTextPopup(false);
                    stopRecordingUserAction();
                    setNewText('');
                  }, "جاري الحفظ...");
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

      {/* Limit Reached Popup */}
      {showLimitPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div 
            className="bg-[#111] border border-white/10 p-8 rounded-[32px] flex flex-col items-center gap-6 w-full max-w-sm shadow-[0_0_40px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-16 h-16 bg-blue-500/10 text-blue-500 rounded-full flex items-center justify-center mb-2">
              <span className="text-3xl font-bold">!</span>
            </div>
            <div className="text-xl text-gray-200 font-medium text-center" dir="rtl">
              الحد الأقصى للكلمات
            </div>
            <div className="text-gray-400 text-center text-[15px] leading-relaxed" dir="rtl">
              لقد وصلت إلى 10 آلاف كلمة وهذا هو الحد الأقصى، الرجاء الصبر من أسبوع إلى أسبوعين لتوسيع الخدمة.
            </div>
            <div className="w-full mt-2">
              <button 
                onClick={() => setShowLimitPopup(false)}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-3 rounded-full transition-all shadow-[0_0_15px_rgba(59,130,246,0.3)] active:scale-95 text-lg"
              >
                حسناً
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rate Limit Popup */}
      {showRateLimitPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div 
            className="bg-[#111] border border-white/10 p-8 rounded-[32px] flex flex-col items-center gap-6 w-full max-w-sm shadow-[0_0_40px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-16 h-16 bg-orange-500/10 text-orange-500 rounded-full flex items-center justify-center mb-2">
              <span className="text-3xl font-bold">!</span>
            </div>
            <div className="text-xl text-gray-200 font-medium text-center" dir="rtl">
              حد الإضافة
            </div>
            <div className="text-gray-400 text-center text-[15px] leading-relaxed" dir="rtl">
              لقد وصلت إلى الحد الأقصى لإضافة النصوص وهو 50 إضافة كل 24 ساعة. يرجى المحاولة مرة أخرى لاحقاً.
            </div>
            <div className="w-full mt-2">
              <button 
                onClick={() => setShowRateLimitPopup(false)}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 rounded-full transition-all shadow-[0_0_15px_rgba(249,115,22,0.3)] active:scale-95 text-lg"
              >
                حسناً
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Edit Limit Popup */}
      {showEditLimitPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div 
            className="bg-[#111] border border-white/10 p-8 rounded-[32px] flex flex-col items-center gap-6 w-full max-w-sm shadow-[0_0_40px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-16 h-16 bg-orange-500/10 text-orange-500 rounded-full flex items-center justify-center mb-2">
              <span className="text-3xl font-bold">!</span>
            </div>
            <div className="text-xl text-gray-200 font-medium text-center" dir="rtl">
              حد التعديل
            </div>
            <div className="text-gray-400 text-center text-[15px] leading-relaxed" dir="rtl">
              لقد وصلت إلى الحد الأقصى لتعديل النصوص وهو 100 تعديل كل 720 ساعة. يمكنك المحاولة مرة أخرى لاحقاً.
            </div>
            <div className="w-full mt-2">
              <button 
                onClick={() => setShowEditLimitPopup(false)}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 rounded-full transition-all shadow-[0_0_15px_rgba(249,115,22,0.3)] active:scale-95 text-lg"
              >
                حسناً
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Edit Limit Popup */}
      {showPasswordEditLimitPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div 
            className="bg-[#111] border border-white/10 p-8 rounded-[32px] flex flex-col items-center gap-6 w-full max-w-sm shadow-[0_0_40px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-16 h-16 bg-orange-500/10 text-orange-500 rounded-full flex items-center justify-center mb-2">
              <span className="text-3xl font-bold">!</span>
            </div>
            <div className="text-xl text-gray-200 font-medium text-center" dir="rtl">
              حد تعديل كلمة المرور
            </div>
            <div className="text-gray-400 text-center text-[15px] leading-relaxed" dir="rtl">
              لقد وصلت إلى الحد الأقصى لتعديل كلمة المرور وهو 3 مرات كل 168 ساعة. يرجى المحاولة لاحقاً.
            </div>
            <div className="w-full mt-2">
              <button 
                onClick={() => setShowPasswordEditLimitPopup(false)}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 rounded-full transition-all shadow-[0_0_15px_rgba(249,115,22,0.3)] active:scale-95 text-lg"
              >
                حسناً
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

                  const currentWords = texts.reduce((count, item) => {
                    const textContent = item.text.trim();
                    return count + (item.id === editTextItem.id ? 0 : (textContent ? textContent.split(/\s+/).length : 0));
                  }, 0);
                  const newWords = editTextInput.trim().split(/\s+/).length;
                  
                  if (currentWords + newWords > 10000) {
                    setShowLimitPopup(true);
                    return;
                  }

                  runWithLoader(async () => {
                    const updatedItem: TextItem = {
                      ...editTextItem,
                      text: editTextInput.trim()
                    };
                    
                    await saveTextToDB(updatedItem, true);
                    setTexts((prev) => prev.map(t => t.id === updatedItem.id ? updatedItem : t));
                    
                    // Record edit timestamp
                    const editHistoryKey = `editHistory_${currentUserId}`;
                    const storedHistory = localStorage.getItem(editHistoryKey);
                    const editTimestamps: number[] = storedHistory ? JSON.parse(storedHistory) : [];
                    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
                    const recentEdits = editTimestamps.filter(ts => Date.now() - ts < THIRTY_DAYS_MS);
                    recentEdits.push(Date.now());
                    localStorage.setItem(editHistoryKey, JSON.stringify(recentEdits));
                    
                    setShowEditTextPopup(false);
                    stopRecordingUserAction();
                    setEditTextItem(null);
                    setEditTextInput('');
                  }, "جاري التعديل...");
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

      {shareModalText && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setShareModalText(null)}>
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
                تم نسخ النص بنجاح!
              </div>

              {navigator.share && (
                <button
                  onClick={async () => {
                    try {
                      await navigator.share({
                        text: shareModalText || '',
                      });
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
                    onClick={() => {
                      navigator.clipboard.writeText(shareModalText || '');
                      alert('تم نسخ النص بنجاح! يتم الآن فتح المنصة لتتمكن من لصقه.');
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

      {isGlobalLoading && (
        <div className="fixed inset-0 bg-black/60 z-[999] flex items-center justify-center backdrop-blur-sm" dir="rtl">
          <div className="bg-[#111] p-8 rounded-2xl flex flex-col items-center justify-center min-w-[250px] shadow-[0_0_40px_rgba(0,0,0,0.8)] border border-white/10 animate-in fade-in zoom-in duration-200">
            <div className="w-16 h-16 border-4 border-white/10 border-t-white rounded-full animate-spin mb-6"></div>
            <div className="text-4xl font-extrabold text-white mb-4">{loadingCount}</div>
            <div className="text-lg text-gray-300 font-medium text-center">{loadingMessage}</div>
          </div>
        </div>
      )}

    </div>
  );
}
