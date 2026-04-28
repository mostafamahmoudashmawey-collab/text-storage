/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Eye, EyeOff, Plus, User, Trash2, Pencil, Copy, Check } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { db } from './db';

interface TextItem {
  id: string;
  userId: string;
  text: string;
  timestamp: number;
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

const saveTextToDB = async (textItem: TextItem) => {
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
    await db.execute({
      sql: `INSERT INTO texts (id, userId, text, timestamp) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET text=excluded.text, timestamp=excluded.timestamp`,
      args: [textItem.id, textItem.userId, textItem.text, textItem.timestamp]
    });
  } catch (e) {
    console.error("Turso save error", e);
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
    const result = await db.execute({
      sql: 'SELECT * FROM texts WHERE userId = ? ORDER BY timestamp DESC',
      args: [userId]
    });
    if (result.rows.length > 0) {
      const texts = result.rows.map(row => ({
        id: row.id as string,
        userId: row.userId as string,
        text: row.text as string,
        timestamp: row.timestamp as number
      }));
      
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
    console.error("Turso fetch error", e);
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
    const placeholders = ids.map(() => '?').join(',');
    await db.execute({
      sql: `DELETE FROM texts WHERE id IN (${placeholders})`,
      args: ids
    });
  } catch (e) {
    console.error("Turso delete error", e);
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
    await db.execute({
      sql: 'INSERT INTO users (id, password) VALUES (?, ?)',
      args: [id, pass]
    });
    success = true;
  } catch (e) {
    console.error("Turso register error", e);
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
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE id = ?',
      args: [id]
    });
    if (result.rows.length > 0) {
      userExists = true;
      if (result.rows[0].password === pass) {
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
    console.error("Turso login error", e);
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
    await db.execute({
      sql: 'UPDATE users SET password = ? WHERE id = ?',
      args: [newPass, id]
    });
  } catch (e) {
    console.error("Turso update password error", e);
  }
};

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'signup' | 'login' | 'dashboard'>('home');
  const [generatedId, setGeneratedId] = useState('');
  const [password, setPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  
  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
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
  const [expandedTexts, setExpandedTexts] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    const idsToDelete = Array.from(selectedTexts);
    await deleteTextsFromDB(idsToDelete);
    setTexts(prev => prev.filter(t => !selectedTexts.has(t.id)));
    setSelectedTexts(new Set());
    setShowDeleteConfirm(false);
  };

  useEffect(() => {
    if (currentView === 'dashboard' && currentUserId) {
      getTextsFromLocalDB(currentUserId).then(loadedTexts => setTexts(loadedTexts));
    }
  }, [currentView, currentUserId]);

  const generateUniqueId = async () => {
    let unique = false;
    let id = '';
    while (!unique) {
      id = Math.floor(10000 + Math.random() * 90000).toString();
      try {
        const result = await db.execute({
          sql: 'SELECT id FROM users WHERE id = ?',
          args: [id]
        });
        if (result.rows.length === 0) {
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
        <span>Text storage</span>
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
              <span className="text-gray-500 text-sm font-medium px-2" title="عدد الإضافات اليوم">{texts.filter(t => Date.now() - t.timestamp < 24 * 60 * 60 * 1000).length}</span>
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
              onClick={async () => {
                const success = await registerUser(generatedId, password);
                if (success) {
                  setCurrentUserId(generatedId);
                  setCurrentPassword(password);
                  saveSession(generatedId, password);
                  setCurrentView('dashboard');
                } else {
                  alert('حدث خطأ أثناء الإنشاء. ربما المعرف مستخدم. حاول مرة أخرى.');
                }
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
              onChange={(e) => setLoginId(e.target.value.replace(/[^0-9]/g, ''))}
              className="bg-white/5 border border-white/20 rounded-xl py-3 px-4 text-center text-2xl tracking-[0.5em] text-white focus:outline-none focus:border-white transition-colors placeholder:text-gray-700 font-mono"
              placeholder="•••••"
              dir="ltr"
            />
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
                className="w-full bg-white/5 border border-white/20 rounded-xl py-3 px-4 text-center text-2xl tracking-[0.5em] text-white focus:outline-none focus:border-white transition-colors placeholder:text-gray-700 font-mono"
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
          </div>

          <div className="flex flex-col w-full gap-3 mt-4">
            <button 
              onClick={async () => {
                const result = await loginUser(loginId, loginPassword);
                if (result.isValid) {
                  await syncTextsFromRemoteDB(loginId);
                  setCurrentUserId(loginId);
                  setCurrentPassword(loginPassword);
                  saveSession(loginId, loginPassword);
                  setCurrentView('dashboard');
                } else {
                  alert(result.error);
                }
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 pb-12 w-full items-start" dir="ltr">
              {texts.map((item) => {
                const words = item.text.split(/\s+/);
                const isLong = item.text.length > 300 || words.length > 50;
                const isExpanded = expandedTexts.has(item.id);
                
                let displayText = item.text;
                if (isLong && !isExpanded) {
                  if (item.text.length > 300) {
                    displayText = item.text.substring(0, 300) + '...';
                  } else {
                    displayText = words.slice(0, 50).join(' ') + '...';
                  }
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
                    className={`bg-white/5 border ${borderClass} rounded-2xl p-5 text-white whitespace-pre-wrap text-[17px] leading-relaxed w-full break-words text-right relative transition-all ${selectedTexts.size > 0 ? 'cursor-pointer' : ''} select-none group`} 
                    dir="rtl"
                  >
                    {!selectedTexts.size && (
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
                        className="absolute bottom-4 left-4 p-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-black/40 hover:bg-black/80 rounded-full text-gray-400 hover:text-white"
                        title="تعديل النص"
                      >
                        <Pencil size={18} strokeWidth={1.5} />
                      </button>
                    )}
                    {displayText}
                    {isLong && (
                      <button 
                        onClick={(e) => {
                          if (selectedTexts.size > 0) return; // disable 'read more' when selecting
                          e.stopPropagation();
                          setExpandedTexts(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has(item.id)) newSet.delete(item.id);
                            else newSet.add(item.id);
                            return newSet;
                          });
                        }}
                        className="text-gray-400 hover:text-white mt-4 text-sm font-medium transition-colors cursor-pointer block bg-transparent border-none outline-none"
                      >
                        {isExpanded ? 'عرض أقل' : 'المزيد'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showUserIdPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[#111] border border-white/10 p-8 rounded-3xl flex flex-col items-center gap-6 w-full max-w-sm shadow-[0_0_40px_rgba(0,0,0,0.8)]">
            <div className="text-xl text-gray-300 font-light">المعرف الخاص بك</div>
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
                    onClick={async () => {
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

            <button 
              onClick={() => {
                setShowUserIdPopup(false);
                setShowUserIdPassword(false);
                setShowVerifyPassword(false);
                setIsEditingPassword(false);
                setVerifyPasswordInput('');
                setVerifyError(false);
              }} 
              className="mt-2 w-full cursor-pointer bg-white hover:bg-gray-200 text-black font-medium py-3 px-8 rounded-full transition-all hover:scale-105 active:scale-95 text-lg"
            >
              اغلاق
            </button>
            <button 
              onClick={handleLogout} 
              className="w-full cursor-pointer bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 font-medium py-3 px-8 rounded-full transition-all hover:scale-105 active:scale-95 text-lg mt-0"
            >
              تسجيل الخروج
            </button>
          </div>
        </div>
      )}

      {showAddTextPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setShowAddTextPopup(false)}>
          <div 
             className="bg-[#111] border border-white/10 p-6 rounded-3xl flex flex-col gap-4 w-full max-w-xl shadow-[0_0_40px_rgba(0,0,0,0.8)] relative"
             onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center w-full pb-1" dir="rtl">
              <div className="text-xl text-gray-300 font-medium">إضافة نص جديد</div>
              <button 
                onClick={() => setShowAddTextPopup(false)}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer text-base bg-transparent border-none outline-none"
              >
                إلغاء
              </button>
            </div>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="اكتب نصك"
              className="w-full h-48 bg-white/5 border border-white/10 rounded-2xl p-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/30 transition-colors resize-none text-lg leading-relaxed custom-scrollbar"
              dir="rtl"
            />
            <div className="flex justify-end w-full mt-2">
              <button 
                onClick={async () => {
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

                  const newItem: TextItem = {
                    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
                    userId: currentUserId,
                    text: newText.trim(),
                    timestamp: Date.now()
                  };
                  await saveTextToDB(newItem);
                  setTexts((prev) => [newItem, ...prev]);
                  setShowAddTextPopup(false);
                  setNewText('');
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
                  setEditTextItem(null);
                  setEditTextInput('');
                }}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer text-base bg-transparent border-none outline-none"
              >
                إلغاء
              </button>
            </div>
            <textarea
              value={editTextInput}
              onChange={(e) => setEditTextInput(e.target.value)}
              placeholder="اكتب تعديلك هنا..."
              className="w-full h-48 bg-white/5 border border-white/10 rounded-2xl p-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/30 transition-colors resize-none text-lg leading-relaxed custom-scrollbar"
              dir="rtl"
            />
            <div className="flex justify-end w-full mt-2">
              <button 
                onClick={async () => {
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

                  const updatedItem: TextItem = {
                    ...editTextItem,
                    text: editTextInput.trim()
                  };
                  
                  await saveTextToDB(updatedItem);
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
                  setEditTextItem(null);
                  setEditTextInput('');
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
    </div>
  );
}
