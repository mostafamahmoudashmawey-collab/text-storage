import React, { useState, useEffect } from 'react';
import { ExternalLink, Megaphone, Settings, X, Plus, Sparkles, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Language } from '../i18n';

export interface ExternalAd {
  id: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  tagEn: string;
  tagAr: string;
  url: string;
  badgeBg: string;
  accentColor: string;
  iconBg: string;
  sponsorDomain: string;
  imageUrl?: string;
  side?: 'left' | 'right' | 'both';
}

const DEFAULT_ADS: ExternalAd[] = [
  {
    id: 'ad_hostinger',
    titleEn: 'Hostinger Cloud Hosting',
    titleAr: 'استضافة هوستنجر السحابية',
    descriptionEn: 'High-speed cloud servers, free SSL, 99.9% uptime & 24/7 support for fast websites.',
    descriptionAr: 'خوادم سحابية فائقة السرعة مع نطاق مجاني وحماية متكاملة لموقعك.',
    tagEn: 'Cloud Hosting',
    tagAr: 'استضافة سحابية',
    url: 'https://www.hostinger.com',
    badgeBg: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    accentColor: 'from-purple-600/30 to-indigo-600/10',
    iconBg: '#673AB7',
    sponsorDomain: 'hostinger.com',
    side: 'left',
  },
  {
    id: 'ad_nordvpn',
    titleEn: 'NordVPN Cyber Security',
    titleAr: 'نورد في بي إن للأمان الرقمي',
    descriptionEn: 'Next-gen encryption and threat protection to secure your browsing and storage.',
    descriptionAr: 'تشفير فائق وحماية خصوصية بياناتك وتصفحك المشفر بأعلى درجات الأمان.',
    tagEn: 'Privacy & Security',
    tagAr: 'أمان وخصوصية',
    url: 'https://nordvpn.com',
    badgeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    accentColor: 'from-blue-600/30 to-cyan-600/10',
    iconBg: '#1E88E5',
    sponsorDomain: 'nordvpn.com',
    side: 'left',
  },
  {
    id: 'ad_proton',
    titleEn: 'Proton Encrypted Drive',
    titleAr: 'بروتون درايف للتخزين المشفر',
    descriptionEn: 'Swiss-based end-to-end encrypted cloud storage for your private files and docs.',
    descriptionAr: 'تخزين سحابي مشفر بالكامل ومحمي بالقوانين السويسرية لملفاتك الخاصة.',
    tagEn: 'Secure Storage',
    tagAr: 'تخزين مشفر',
    url: 'https://proton.me',
    badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    accentColor: 'from-emerald-600/30 to-teal-600/10',
    iconBg: '#6D4AFF',
    sponsorDomain: 'proton.me',
    side: 'left',
  },
  {
    id: 'ad_digitalocean',
    titleEn: 'DigitalOcean Spaces',
    titleAr: 'ديجيتال أوشن للتخزين السحابي',
    descriptionEn: 'Scalable S3-compatible object storage with built-in CDN for developer apps.',
    descriptionAr: 'تخزين ملفات غير محدود ومتوافق مع S3 مع شبكة CDN فائقة السرعة.',
    tagEn: 'Object Storage',
    tagAr: 'تخزين كائنات',
    url: 'https://www.digitalocean.com',
    badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    accentColor: 'from-cyan-600/30 to-blue-600/10',
    iconBg: '#0080FF',
    sponsorDomain: 'digitalocean.com',
    side: 'right',
  },
  {
    id: 'ad_canva',
    titleEn: 'Canva Design & Photos',
    titleAr: 'كانفا لتصميم وتعديل الصور',
    descriptionEn: 'Create stunning graphics, edit images and optimize photo assets in minutes.',
    descriptionAr: 'صمم وعدل صورك ومستنداتك باحترافية وسهولة مع أدوات ذكاء اصطناعي حديثة.',
    tagEn: 'Photo & Design',
    tagAr: 'تصميم وصور',
    url: 'https://www.canva.com',
    badgeBg: 'bg-pink-500/20 text-pink-300 border-pink-500/40',
    accentColor: 'from-pink-600/30 to-rose-600/10',
    iconBg: '#00C4CC',
    sponsorDomain: 'canva.com',
    side: 'right',
  },
  {
    id: 'ad_cloudflare',
    titleEn: 'Cloudflare Global CDN',
    titleAr: 'كلاودفلير لتسريع وحماية المواقع',
    descriptionEn: 'Speed up content delivery and block DDoS attacks with world-class edge network.',
    descriptionAr: 'تسريع تحميل وتوزيع المحتوى وحماية مواقعك من الهجمات الإلكترونية مجاناً.',
    tagEn: 'Web CDN & DNS',
    tagAr: 'تسريع وحماية',
    url: 'https://www.cloudflare.com',
    badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    accentColor: 'from-amber-600/30 to-orange-600/10',
    iconBg: '#F38020',
    sponsorDomain: 'cloudflare.com',
    side: 'right',
  }
];

interface SideAdsProps {
  language: Language;
}

export const SideAds: React.FC<SideAdsProps> = ({ language }) => {
  const isAr = language === 'ar';
  
  // Custom external ads saved by user/admin
  const [customAds, setCustomAds] = useState<ExternalAd[]>(() => {
    try {
      const saved = localStorage.getItem('inter_storage_custom_ads');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Google AdSense publisher ID if set
  const [adsenseClientId, setAdsenseClientId] = useState<string>(() => {
    return localStorage.getItem('inter_storage_adsense_client') || '';
  });

  const [isLeftVisible, setIsLeftVisible] = useState(true);
  const [isRightVisible, setIsRightVisible] = useState(true);
  const [isMobileModalOpen, setIsMobileModalOpen] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Indexes for rotating
  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(0);

  // Form for adding new external ad
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formDomain, setFormDomain] = useState('');
  const [formTag, setFormTag] = useState('');
  const [formSide, setFormSide] = useState<'left' | 'right' | 'both'>('both');
  const [formAdsense, setFormAdsense] = useState(adsenseClientId);

  const allAds = [...DEFAULT_ADS, ...customAds];

  const leftAds = allAds.filter(a => a.side === 'left' || a.side === 'both' || !a.side);
  const rightAds = allAds.filter(a => a.side === 'right' || a.side === 'both' || !a.side);

  // Rotation timer
  useEffect(() => {
    const timer = setInterval(() => {
      setLeftIndex(prev => (prev + 1) % Math.max(leftAds.length, 1));
      setRightIndex(prev => (prev + 1) % Math.max(rightAds.length, 1));
    }, 20000); // 20s rotation
    return () => clearInterval(timer);
  }, [leftAds.length, rightAds.length]);

  // Load AdSense script dynamically if publisher ID provided
  useEffect(() => {
    if (adsenseClientId && adsenseClientId.startsWith('ca-pub-')) {
      const existingScript = document.getElementById('adsense-script');
      if (!existingScript) {
        const script = document.createElement('script');
        script.id = 'adsense-script';
        script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClientId}`;
        script.async = true;
        script.crossOrigin = 'anonymous';
        document.head.appendChild(script);
      }
    }
  }, [adsenseClientId]);

  const handleSaveCustomAd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formUrl) return;

    let cleanUrl = formUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    let parsedDomain = formDomain.trim();
    if (!parsedDomain) {
      try {
        parsedDomain = new URL(cleanUrl).hostname.replace('www.', '');
      } catch {
        parsedDomain = 'external-site.com';
      }
    }

    const newAd: ExternalAd = {
      id: 'custom_' + Date.now(),
      titleEn: formTitle.trim() || parsedDomain,
      titleAr: formTitle.trim() || parsedDomain,
      descriptionEn: formDesc.trim() || 'Explore external services and special offers.',
      descriptionAr: formDesc.trim() || 'اكتشف خدمات المنصة الخارجية والعروض الحصرية.',
      tagEn: formTag.trim() || 'External Partner',
      tagAr: formTag.trim() || 'شريك خارجي',
      url: cleanUrl,
      badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      accentColor: 'from-emerald-600/30 to-cyan-600/10',
      iconBg: '#059669',
      sponsorDomain: parsedDomain,
      side: formSide,
    };

    const updated = [...customAds, newAd];
    setCustomAds(updated);
    localStorage.setItem('inter_storage_custom_ads', JSON.stringify(updated));

    // Reset inputs
    setFormTitle('');
    setFormDesc('');
    setFormUrl('');
    setFormDomain('');
    setFormTag('');
  };

  const handleDeleteCustomAd = (id: string) => {
    const updated = customAds.filter(a => a.id !== id);
    setCustomAds(updated);
    localStorage.setItem('inter_storage_custom_ads', JSON.stringify(updated));
  };

  const handleSaveAdsense = () => {
    const cleaned = formAdsense.trim();
    setAdsenseClientId(cleaned);
    if (cleaned) {
      localStorage.setItem('inter_storage_adsense_client', cleaned);
    } else {
      localStorage.removeItem('inter_storage_adsense_client');
    }
  };

  const renderAdCard = (ad: ExternalAd, positionLabel: string) => {
    const title = isAr ? ad.titleAr : ad.titleEn;
    const desc = isAr ? ad.descriptionAr : ad.descriptionEn;
    const tag = isAr ? ad.tagAr : ad.tagEn;

    return (
      <a
        key={ad.id}
        href={ad.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative flex flex-col justify-between p-3.5 rounded-2xl bg-gradient-to-b from-[#161616] to-[#0c0c0c] border border-white/10 hover:border-white/30 transition-all duration-300 shadow-[0_8px_20px_rgba(0,0,0,0.6)] hover:shadow-[0_12px_28px_rgba(34,211,238,0.15)] hover:-translate-y-0.5 select-none overflow-hidden text-left"
        dir={isAr ? 'rtl' : 'ltr'}
      >
        {/* Subtle glowing accent */}
        <div className={`absolute -top-12 -right-12 w-28 h-28 bg-gradient-to-br ${ad.accentColor} blur-2xl rounded-full pointer-events-none group-hover:scale-125 transition-transform duration-500`} />

        <div>
          {/* Top header row */}
          <div className="flex items-center justify-between gap-1 mb-2">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ad.badgeBg} tracking-wide flex items-center gap-1`}>
              <Sparkles size={10} />
              {tag}
            </span>
            <span className="text-[9px] text-gray-400 font-mono tracking-wider flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              {isAr ? 'إعلان خارجي' : 'External Ad'}
            </span>
          </div>

          {/* Title & Domain */}
          <h4 className="text-white font-bold text-xs sm:text-sm tracking-tight leading-snug line-clamp-2 group-hover:text-cyan-300 transition-colors">
            {title}
          </h4>

          <div className="text-[11px] text-cyan-400/90 font-mono mt-0.5 flex items-center gap-1">
            <span>{ad.sponsorDomain}</span>
            <ExternalLink size={10} className="opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </div>

          {/* Description */}
          <p className="text-gray-400 text-[11px] leading-relaxed mt-2 line-clamp-3">
            {desc}
          </p>
        </div>

        {/* CTA Button */}
        <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between">
          <span className="text-[11px] font-medium text-gray-300 group-hover:text-white transition-colors flex items-center gap-1">
            {isAr ? 'زيارة الموقع' : 'Visit Site'}
          </span>
          <div className="w-6 h-6 rounded-lg bg-white/10 group-hover:bg-cyan-500 group-hover:text-black text-white flex items-center justify-center transition-all duration-300 shadow-sm">
            <ExternalLink size={12} />
          </div>
        </div>
      </a>
    );
  };

  const currentLeftAd = leftAds[leftIndex % leftAds.length] || leftAds[0];
  const nextLeftAd = leftAds[(leftIndex + 1) % leftAds.length] || leftAds[1] || currentLeftAd;

  const currentRightAd = rightAds[rightIndex % rightAds.length] || rightAds[0];
  const nextRightAd = rightAds[(rightIndex + 1) % rightAds.length] || rightAds[1] || currentRightAd;

  return (
    <>
      {/* ----------------- LEFT SIDEBAR ADS (Desktop / Tablet >= 1080px) ----------------- */}
      <aside
        aria-label="External Advertisements Left"
        className={`hidden min-[1080px]:flex fixed left-3 top-20 bottom-8 w-[165px] xl:w-[195px] flex-col z-30 pointer-events-none transition-all duration-300 ${
          isLeftVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8 pointer-events-none'
        }`}
      >
        <div className="pointer-events-auto flex flex-col h-full bg-[#0a0a0a]/90 backdrop-blur-md border border-white/10 rounded-2xl p-2.5 shadow-2xl overflow-hidden justify-between">
          {/* Top Banner Bar */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 text-gray-400 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-[11px] text-gray-300">
              <Megaphone size={13} className="text-cyan-400" />
              <span>{isAr ? 'إعلانات اليسار' : 'Left Ads'}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setLeftIndex(prev => (prev + 1) % leftAds.length)}
                className="p-1 hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors"
                title={isAr ? 'إعلان آخر' : 'Next Ad'}
              >
                <RefreshCw size={11} />
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                className="p-1 hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors"
                title={isAr ? 'إعدادات الإعلانات' : 'Ad Settings'}
              >
                <Settings size={11} />
              </button>
              <button
                type="button"
                onClick={() => setIsLeftVisible(false)}
                className="p-1 hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors"
                title={isAr ? 'إخفاء مؤقت' : 'Hide'}
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Ad Cards Stack */}
          <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto custom-scrollbar pr-0.5 justify-start">
            {currentLeftAd && renderAdCard(currentLeftAd, 'left-1')}
            {nextLeftAd && nextLeftAd.id !== currentLeftAd?.id && renderAdCard(nextLeftAd, 'left-2')}

            {adsenseClientId && (
              <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-center text-[10px] text-gray-400">
                <p>{isAr ? 'مساحة إعلانات Google' : 'Google Ad Area'}</p>
                <span className="font-mono text-[9px] text-cyan-400">{adsenseClientId}</span>
              </div>
            )}
          </div>

          {/* Footer Note */}
          <div className="pt-2 mt-2 border-t border-white/5 text-[9px] text-gray-500 text-center flex items-center justify-center gap-1">
            <span>{isAr ? 'مواقع خارجية موثوقة' : 'External Partners'}</span>
          </div>
        </div>
      </aside>

      {/* Button to restore Left Ad if closed */}
      {!isLeftVisible && (
        <button
          type="button"
          onClick={() => setIsLeftVisible(true)}
          className="hidden min-[1080px]:flex fixed left-2 top-24 z-30 bg-[#141414] hover:bg-[#202020] text-gray-300 hover:text-cyan-400 border border-white/15 rounded-r-xl px-2.5 py-2 shadow-lg items-center gap-1.5 text-xs transition-all cursor-pointer"
          title={isAr ? 'إظهار إعلانات اليسار' : 'Show Left Ads'}
        >
          <Megaphone size={13} className="text-cyan-400" />
          <span className="text-[11px] font-medium">{isAr ? 'إعلانات' : 'Ads'}</span>
          <ChevronRight size={13} />
        </button>
      )}

      {/* ----------------- RIGHT SIDEBAR ADS (Desktop / Tablet >= 1080px) ----------------- */}
      <aside
        aria-label="External Advertisements Right"
        className={`hidden min-[1080px]:flex fixed right-3 top-20 bottom-8 w-[165px] xl:w-[195px] flex-col z-30 pointer-events-none transition-all duration-300 ${
          isRightVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none'
        }`}
      >
        <div className="pointer-events-auto flex flex-col h-full bg-[#0a0a0a]/90 backdrop-blur-md border border-white/10 rounded-2xl p-2.5 shadow-2xl overflow-hidden justify-between">
          {/* Top Banner Bar */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 text-gray-400 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-[11px] text-gray-300">
              <Megaphone size={13} className="text-pink-400" />
              <span>{isAr ? 'إعلانات اليمين' : 'Right Ads'}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRightIndex(prev => (prev + 1) % rightAds.length)}
                className="p-1 hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors"
                title={isAr ? 'إعلان آخر' : 'Next Ad'}
              >
                <RefreshCw size={11} />
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                className="p-1 hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors"
                title={isAr ? 'إعدادات الإعلانات' : 'Ad Settings'}
              >
                <Settings size={11} />
              </button>
              <button
                type="button"
                onClick={() => setIsRightVisible(false)}
                className="p-1 hover:text-white hover:bg-white/10 rounded cursor-pointer transition-colors"
                title={isAr ? 'إخفاء مؤقت' : 'Hide'}
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Ad Cards Stack */}
          <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto custom-scrollbar pr-0.5 justify-start">
            {currentRightAd && renderAdCard(currentRightAd, 'right-1')}
            {nextRightAd && nextRightAd.id !== currentRightAd?.id && renderAdCard(nextRightAd, 'right-2')}

            {adsenseClientId && (
              <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-center text-[10px] text-gray-400">
                <p>{isAr ? 'مساحة إعلانات Google' : 'Google Ad Area'}</p>
                <span className="font-mono text-[9px] text-cyan-400">{adsenseClientId}</span>
              </div>
            )}
          </div>

          {/* Footer Note */}
          <div className="pt-2 mt-2 border-t border-white/5 text-[9px] text-gray-500 text-center flex items-center justify-center gap-1">
            <span>{isAr ? 'مواقع خارجية موثوقة' : 'External Partners'}</span>
          </div>
        </div>
      </aside>

      {/* Button to restore Right Ad if closed */}
      {!isRightVisible && (
        <button
          type="button"
          onClick={() => setIsRightVisible(true)}
          className="hidden min-[1080px]:flex fixed right-2 top-24 z-30 bg-[#141414] hover:bg-[#202020] text-gray-300 hover:text-cyan-400 border border-white/15 rounded-l-xl px-2.5 py-2 shadow-lg items-center gap-1.5 text-xs transition-all cursor-pointer"
          title={isAr ? 'إظهار إعلانات اليمين' : 'Show Right Ads'}
        >
          <ChevronLeft size={13} />
          <span className="text-[11px] font-medium">{isAr ? 'إعلانات' : 'Ads'}</span>
          <Megaphone size={13} className="text-pink-400" />
        </button>
      )}

      {/* ----------------- MOBILE & SMALL SCREEN FLOATING AD BUTTON (< 1080px) ----------------- */}
      <div className="flex min-[1080px]:hidden fixed bottom-3 left-3 z-30 pointer-events-auto">
        <button
          type="button"
          onClick={() => setIsMobileModalOpen(true)}
          className="flex items-center gap-2 bg-[#141414]/90 hover:bg-[#222]/90 backdrop-blur-md text-gray-200 border border-white/15 px-3 py-2 rounded-full shadow-lg text-xs transition-all hover:scale-105 active:scale-95 cursor-pointer"
        >
          <Megaphone size={13} className="text-cyan-400 animate-pulse" />
          <span className="font-medium text-[11px]">{isAr ? 'إعلانات الشركاء' : 'Partner Ads'}</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
        </button>
      </div>

      {/* Mobile Ads Drawer / Modal */}
      {isMobileModalOpen && (
        <div
          className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-3 min-[1080px]:hidden animate-fadeIn"
          onClick={() => setIsMobileModalOpen(false)}
        >
          <div
            className="bg-[#111] border border-white/15 rounded-3xl w-full max-w-md max-h-[85vh] p-4 flex flex-col shadow-2xl relative"
            onClick={e => e.stopPropagation()}
            dir={isAr ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Megaphone size={18} className="text-cyan-400" />
                <h3 className="text-base font-bold text-white">
                  {isAr ? 'إعلانات المواقع الخارجية' : 'External Partner Ads'}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  title={isAr ? 'إعدادات الإعلانات' : 'Ad Settings'}
                >
                  <Settings size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsMobileModalOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3 pr-1">
              <p className="text-xs text-gray-400">
                {isAr
                  ? 'روابط وخدمات مميزة من منصات وشركاء خارجيين موثوقين:'
                  : 'Selected tools and services from trusted external partners:'}
              </p>
              {allAds.map(ad => renderAdCard(ad, 'mobile'))}
            </div>
          </div>
        </div>
      )}

      {/* ----------------- AD SETTINGS & CUSTOM EXTERNAL AD MANAGER MODAL ----------------- */}
      {showSettingsModal && (
        <div
          className="fixed inset-0 z-[250] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn"
          onClick={() => setShowSettingsModal(false)}
        >
          <div
            className="bg-[#0f0f0f] border border-white/15 rounded-3xl w-full max-w-lg p-5 sm:p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto custom-scrollbar"
            onClick={e => e.stopPropagation()}
            dir={isAr ? 'rtl' : 'ltr'}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Settings size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    {isAr ? 'إدارة وربط الإعلانات الخارجية' : 'External Ads Configuration'}
                  </h3>
                  <p className="text-xs text-gray-400">
                    {isAr ? 'ربط شبكات إعلانية مثل Google AdSense أو إضافة إعلانات مخصصة' : 'Connect external ad networks or add custom sponsor links'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Google AdSense Section */}
            <div className="mb-6 p-4 rounded-2xl bg-white/5 border border-white/10">
              <h4 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                {isAr ? 'ربط حساب Google AdSense' : 'Connect Google AdSense'}
              </h4>
              <p className="text-xs text-gray-400 mb-3">
                {isAr
                  ? 'أدخل معرّف الناشر الخاص بك (مثال: ca-pub-1234567890123456) ليتم تفعيل إعلانات جوجل تلقائياً في اليسار واليمين.'
                  : 'Enter your Publisher ID (e.g. ca-pub-1234567890123456) to auto-inject Google ads on sides.'}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formAdsense}
                  onChange={e => setFormAdsense(e.target.value)}
                  placeholder="ca-pub-XXXXXXXXXXXXXXXX"
                  className="flex-1 bg-black/60 border border-white/20 rounded-xl px-3.5 py-2 text-sm text-white font-mono outline-none focus:border-cyan-400 transition-colors placeholder:text-gray-600"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={handleSaveAdsense}
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-sm rounded-xl transition-all cursor-pointer shadow-sm active:scale-95"
                >
                  {isAr ? 'حفظ' : 'Save'}
                </button>
              </div>
              {adsenseClientId && (
                <div className="mt-2 text-[11px] text-emerald-400 flex items-center gap-1.5 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  {isAr ? 'تم الربط بنجاح:' : 'Connected:'} {adsenseClientId}
                </div>
              )}
            </div>

            {/* Add Custom External Ad Form */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 mb-5">
              <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <Plus size={16} className="text-emerald-400" />
                {isAr ? 'إضافة إعلان لموقع خارجي جديد' : 'Add New External Website Ad'}
              </h4>
              <form onSubmit={handleSaveCustomAd} className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">
                    {isAr ? 'رابط الموقع الخارجي (URL) *' : 'External Website Link (URL) *'}
                  </label>
                  <input
                    type="url"
                    required
                    value={formUrl}
                    onChange={e => setFormUrl(e.target.value)}
                    placeholder="https://example.com/offer"
                    className="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-xs sm:text-sm text-white font-mono outline-none focus:border-white/40"
                    dir="ltr"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-gray-400 mb-1 block">
                      {isAr ? 'عنوان الإعلان' : 'Ad Title'}
                    </label>
                    <input
                      type="text"
                      value={formTitle}
                      onChange={e => setFormTitle(e.target.value)}
                      placeholder={isAr ? 'مثال: خصم 50% على الاستضافة' : 'e.g. 50% Off Cloud'}
                      className="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-white/40"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-400 mb-1 block">
                      {isAr ? 'اسم النطاق / الشريك' : 'Domain / Sponsor Name'}
                    </label>
                    <input
                      type="text"
                      value={formDomain}
                      onChange={e => setFormDomain(e.target.value)}
                      placeholder="example.com"
                      className="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-xs sm:text-sm text-white font-mono outline-none focus:border-white/40"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">
                    {isAr ? 'الوصف الترويجي' : 'Ad Description'}
                  </label>
                  <textarea
                    rows={2}
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    placeholder={isAr ? 'اكتب نبذة ترويجية سريعة تجذب الزوار...' : 'Brief promotional text...'}
                    className="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-white/40 resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-gray-400 mb-1 block">
                      {isAr ? 'مكان الظهور' : 'Placement Side'}
                    </label>
                    <select
                      value={formSide}
                      onChange={e => setFormSide(e.target.value as any)}
                      className="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-xs sm:text-sm text-white outline-none"
                    >
                      <option value="both">{isAr ? 'الجانبين (يسار ويمين)' : 'Both (Left & Right)'}</option>
                      <option value="left">{isAr ? 'الجانب الأيسر فقط' : 'Left Side Only'}</option>
                      <option value="right">{isAr ? 'الجانب الأيمن فقط' : 'Right Side Only'}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-400 mb-1 block">
                      {isAr ? 'تصنيف الإعلان' : 'Category Tag'}
                    </label>
                    <input
                      type="text"
                      value={formTag}
                      onChange={e => setFormTag(e.target.value)}
                      placeholder={isAr ? 'مثال: شريك معتمد' : 'e.g. Partner'}
                      className="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-xs sm:text-sm text-white outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full mt-2 py-2.5 bg-white text-black hover:bg-gray-100 font-semibold text-sm rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm active:scale-95"
                >
                  <Plus size={16} />
                  {isAr ? 'إضافة هذا الإعلان للظهور' : 'Add External Ad'}
                </button>
              </form>
            </div>

            {/* List of Custom Ads */}
            {customAds.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-400 mb-2">
                  {isAr ? 'الإعلانات المخصصة المضافة حالياً:' : 'Your Custom External Ads:'}
                </h4>
                <div className="flex flex-col gap-2">
                  {customAds.map(ad => (
                    <div
                      key={ad.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/10 text-xs"
                    >
                      <div className="flex flex-col">
                        <span className="text-white font-medium">{ad.titleAr}</span>
                        <span className="text-cyan-400 font-mono text-[10px]">{ad.url}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomAd(ad.id)}
                        className="text-red-400 hover:text-red-300 p-1.5 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                        title={isAr ? 'حذف الإعلان' : 'Delete'}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-white/10 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-colors cursor-pointer"
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
