document.addEventListener("DOMContentLoaded", () => {
  // Backend API Base URL Configuration for GitHub Pages & Railway Hosting
  const API_BASE_URL = window.GOWASH_API_URL || 
    (window.location.hostname.includes('github.io') 
      ? "https://gowash-production.up.railway.app" 
      : "");

  // Resilient API Fetch Helper with Credentials & Cross-Origin Header Storage
  async function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const pid = localStorage.getItem("gowash_pid");
    const headers = {
      "Content-Type": "application/json",
      ...(pid ? { "X-Participant-Id": pid } : {}),
      ...(options.headers || {})
    };

    const res = await fetch(url, {
      ...options,
      credentials: "include",
      headers
    });

    const serverPid = res.headers.get("X-Participant-Id");
    if (serverPid) {
      try { localStorage.setItem("gowash_pid", serverPid); } catch (e) {}
    }

    return res;
  }

  // Core Elements
  const spinBtn = document.getElementById("spinBtn");
  const spinBtnLabel = document.getElementById("spinBtnLabel");
  const spinStatusMsg = document.getElementById("spinStatusMsg");
  const campaignAlert = document.getElementById("campaignAlert");

  // Entry Screen Elements
  const entryScreenSection = document.getElementById("entryScreenSection");
  const entryCard = document.getElementById("entryCard");
  const entryForm = document.getElementById("entryForm");
  const entryNameInput = document.getElementById("entryNameInput");
  const entryPhoneInput = document.getElementById("entryPhoneInput");
  const entrySubmitBtn = document.getElementById("entrySubmitBtn");
  const entryBtnLabel = document.getElementById("entryBtnLabel");
  const entryNameError = document.getElementById("entryNameError");
  const entryPhoneError = document.getElementById("entryPhoneError");
  const alreadyParticipatedCard = document.getElementById("alreadyParticipatedCard");
  const existingParticipantName = document.getElementById("existingParticipantName");
  const viewMyPrizeBtn = document.getElementById("viewMyPrizeBtn");
  const entryTransitionCard = document.getElementById("entryTransitionCard");
  const transitionParticipantName = document.getElementById("transitionParticipantName");

  // Spin Screen Section Elements
  const spinScreenSection = document.getElementById("spinScreenSection");
  const spinGreetingTitle = document.getElementById("spinGreetingTitle");

  // Terms Modal Elements
  const termsModal = document.getElementById("termsModal");
  const termsCloseIcon = document.getElementById("termsCloseIcon");
  const declineTermsBtn = document.getElementById("declineTermsBtn");
  const agreeAndSpinBtn = document.getElementById("agreeAndSpinBtn");

  // Wheel Arena Elements
  const wheelArena = document.getElementById("wheelArena");

  // Persistent Winner Ticket Elements
  const winnerPersistentCard = document.getElementById("winnerPersistentCard");
  const ticketBadgeText = document.getElementById("ticketBadgeText");
  const ticketStatusBadge = document.getElementById("ticketStatusBadge");
  const ticketKickerText = document.getElementById("ticketKickerText");
  const savedPrizeTitle = document.getElementById("savedPrizeTitle");
  const savedPrizeSubtext = document.getElementById("savedPrizeSubtext");
  const savedParticipantName = document.getElementById("savedParticipantName");
  const savedParticipantPhone = document.getElementById("savedParticipantPhone");
  const savedPromoCode = document.getElementById("savedPromoCode");
  const copySavedCodeBtn = document.getElementById("copySavedCodeBtn");
  const copySavedCodeText = document.getElementById("copySavedCodeText");
  const savedBookingBtn = document.getElementById("savedBookingBtn");
  const savedShareBtn = document.getElementById("savedShareBtn");
  const savedHowToUseBtn = document.getElementById("savedHowToUseBtn");
  const ticketRedeemedNotice = document.getElementById("ticketRedeemedNotice");

  // Celebration Modal Elements
  const winnerModal = document.getElementById("winnerModal");
  const modalCloseBtn = document.getElementById("modalCloseBtn");
  const modalPrizeCard = document.getElementById("modalPrizeCard");
  const promoCodeDisplay = document.getElementById("promoCodeDisplay");
  const copyCodeBtn = document.getElementById("copyCodeBtn");
  const copyBtnText = document.getElementById("copyBtnText");
  const bookingCtaBtn = document.getElementById("bookingCtaBtn");
  const shareResultBtn = document.getElementById("shareResultBtn");
  const modalHowToUseBtn = document.getElementById("modalHowToUseBtn");

  // Recover Modal Elements
  const recoverModal = document.getElementById("recoverModal");
  const openRecoverModalBtn = document.getElementById("openRecoverModalBtn");
  const recoverCloseBtn = document.getElementById("recoverCloseBtn");
  const recoverPhoneInput = document.getElementById("recoverPhoneInput");
  const submitRecoverBtn = document.getElementById("submitRecoverBtn");
  const recoverErrorMsg = document.getElementById("recoverErrorMsg");

  // Section & Global Elements
  const howToUseSection = document.getElementById("howToUseSection");
  const appToast = document.getElementById("appToast");

  // State
  let visualPrizes = [];
  let wheelInstance = null;
  let campaignState = 'ACTIVE';
  let hasUserWon = false;
  let currentWinningPrizeLabel = "خصم اليوم الوطني 96";
  const currentTermsVersion = "1.1";
  let currentParticipant = null;
  let cachedExistingPrize = null;

  let toastTimer = null;
  function showToast(message) {
    if (!appToast) return;
    if (toastTimer) clearTimeout(toastTimer);
    appToast.textContent = message;
    appToast.classList.add("is-visible");
    toastTimer = setTimeout(() => {
      appToast.classList.remove("is-visible");
    }, 2800);
  }

  // Saudi phone normalizer
  function normalizeSaudiPhone(rawPhone) {
    if (!rawPhone || typeof rawPhone !== 'string') return null;
    let cleaned = rawPhone.trim().replace(/[\s\-\(\)\.]/g, '');
    if (cleaned.startsWith('+966')) {
      cleaned = '0' + cleaned.slice(4);
    } else if (cleaned.startsWith('00966')) {
      cleaned = '0' + cleaned.slice(5);
    } else if (cleaned.startsWith('966')) {
      cleaned = '0' + cleaned.slice(3);
    }
    if (/^5[0-9]{8}$/.test(cleaned)) {
      cleaned = '0' + cleaned;
    }
    if (/^05[0-9]{8}$/.test(cleaned)) {
      return cleaned;
    }
    return null;
  }

  // Pre-filled WhatsApp Booking URL
  function getWhatsAppUrl(code, prizeLabel, prizeSubtext) {
    const phone = "966580700242";
    const text = `مرحباً Go Wash، شاركت في فعالية اليوم الوطني 96 وحصلت على:\n` +
                 `🎁 الهدية: ${prizeLabel}${prizeSubtext ? ` (${prizeSubtext})` : ''}\n` +
                 `🏷️ الكود: ${code}\n` +
                 `أرغب في حجز موعد لغسيل وتلميع سيارتي بالخصم.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  // Web Audio Synthesizer (Zero External Dependencies)
  const soundEngine = {
    ctx: null,
    enabled: localStorage.getItem("gowash_sound_enabled") !== "false",
    init() {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.ctx = new AudioContext();
      }
      if (this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
    },
    playTick(pitchMod = 1) {
      if (!this.enabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        
        // High-frequency tactile snap
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "triangle";
        const baseFreq = (880 + Math.random() * 40) * pitchMod;
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.038);
        
        gain.gain.setValueAtTime(0.26, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.038);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);

        // Low body click for realistic wheel weight
        const subOsc = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        subOsc.type = "sine";
        subOsc.frequency.setValueAtTime(180 * pitchMod, now);
        subOsc.frequency.exponentialRampToValueAtTime(60, now + 0.03);
        subGain.gain.setValueAtTime(0.18, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        subOsc.connect(subGain);
        subGain.connect(this.ctx.destination);
        subOsc.start(now);
        subOsc.stop(now + 0.032);
      } catch (e) {}
    },
    playWinFanfare() {
      if (!this.enabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        // Clean, elegant harmonic chords (C5, E5, G5, C6)
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const startTime = this.ctx.currentTime + (idx * 0.09);
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.22, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.65);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.7);
        });
      } catch (e) {}
    },
    toggle() {
      this.enabled = !this.enabled;
      localStorage.setItem("gowash_sound_enabled", this.enabled ? "true" : "false");
      return this.enabled;
    }
  };

  // Sound Toggle Button Handler
  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const soundIcon = document.getElementById("soundIcon");

  function updateSoundUI(isEnabled) {
    if (!soundToggleBtn || !soundIcon) return;
    soundIcon.textContent = isEnabled ? "🔊" : "🔇";
    soundToggleBtn.classList.toggle("is-muted", !isEnabled);
  }

  if (soundToggleBtn) {
    updateSoundUI(soundEngine.enabled);
    soundToggleBtn.addEventListener("click", () => {
      const active = soundEngine.toggle();
      updateSoundUI(active);
      if (active) soundEngine.playTick();
    });
  }

  // Visual Wheel Canvas Engine: Automotive Precision Dial
  class VisualWheel {
    constructor(canvasId, prizes) {
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas.getContext("2d");
      this.prizes = prizes;
      this.num = prizes.length;
      this.arc = (2 * Math.PI) / this.num;
      this.rotation = 0;
      this.isSpinning = false;

      this.initDPI();
      this.draw();
      this.initDialTicks();
    }

    initDPI() {
      const dpr = Math.max(window.devicePixelRatio || 1, 2);
      this.size = 460;
      this.canvas.width = this.size * dpr;
      this.canvas.height = this.size * dpr;
      this.ctx.scale(dpr, dpr);
    }

    initDialTicks() {
      const ring = document.getElementById("wheelLedRing");
      if (!ring) return;
      ring.innerHTML = "";
      const totalTicks = 36;
      const radius = 184;
      for (let i = 0; i < totalTicks; i++) {
        const tick = document.createElement("div");
        const angle = (i / totalTicks) * (2 * Math.PI);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const deg = (angle * 180 / Math.PI) + 90;
        const isMajor = i % 3 === 0;
        tick.style.cssText = `
          position: absolute;
          width: ${isMajor ? '2px' : '1px'};
          height: ${isMajor ? '8px' : '5px'};
          background: ${isMajor ? '#38BDF8' : 'rgba(255, 255, 255, 0.2)'};
          top: calc(50% + ${y}px - 4px);
          left: calc(50% + ${x}px - 1px);
          transform: rotate(${deg}deg);
        `;
        ring.appendChild(tick);
      }
    }

    draw() {
      const center = this.size / 2;
      const radius = center - 12;

      this.ctx.clearRect(0, 0, this.size, this.size);
      this.ctx.save();
      this.ctx.translate(center, center);
      this.ctx.rotate(this.rotation);

      // 1. Draw Sectors (Go Wash Blue, White, Saudi Green, and Signature Navy/Orange)
      for (let i = 0; i < this.num; i++) {
        const p = this.prizes[i];
        const start = i * this.arc;
        const end = start + this.arc;
        const midAngle = start + this.arc / 2;

        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.arc(0, 0, radius, start, end);

        const isGrand = p.id === 'signature_upgrade' || p.type === 'upgrade';
        const isGreen = p.color === '#006C35' || p.color === '#005429';

        if (isGrand) {
          // Signature: Deep Go Wash Navy with Electric Orange presence
          this.ctx.fillStyle = "#07111E";
        } else if (isGreen) {
          // Saudi Royal Green
          this.ctx.fillStyle = "#006C35";
        } else if (i % 2 === 0) {
          // Go Wash Solid Blue
          this.ctx.fillStyle = "#0052CC";
        } else {
          // Crisp White
          this.ctx.fillStyle = "#FFFFFF";
        }

        this.ctx.fill();

        // Sector Divider Line: Clean hairline
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(Math.cos(start) * radius, Math.sin(start) * radius);
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        this.ctx.stroke();

        // Sector Typography
        this.ctx.save();
        this.ctx.rotate(midAngle);
        this.ctx.textAlign = "right";
        this.ctx.textBaseline = "middle";

        const isWhiteSector = !isGrand && !isGreen && (i % 2 !== 0);

        if (isGrand) {
          this.ctx.fillStyle = "#FF5500";
          this.ctx.font = "900 21px 'Cairo', sans-serif";
          this.ctx.fillText("SIGNATURE", radius - 26, 0);

          this.ctx.fillStyle = "#FFFFFF";
          this.ctx.font = "800 11px 'Cairo', sans-serif";
          this.ctx.fillText("باقة مجانية", radius - 26, 20);
        } else if (isWhiteSector) {
          this.ctx.fillStyle = "#0B192C";
          this.ctx.font = "900 23px 'Cairo', sans-serif";
          this.ctx.fillText(p.label, radius - 26, 0);

          if (p.subtext) {
            this.ctx.fillStyle = "#0052CC";
            this.ctx.font = "800 11px 'Cairo', sans-serif";
            const shortSub = p.subtext.includes("خصم") ? "خصم فوري" : p.subtext;
            this.ctx.fillText(shortSub, radius - 26, 20);
          }
        } else {
          this.ctx.fillStyle = "#FFFFFF";
          this.ctx.font = "900 23px 'Cairo', sans-serif";
          this.ctx.fillText(p.label, radius - 26, 0);

          if (p.subtext) {
            this.ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            this.ctx.font = "800 11px 'Cairo', sans-serif";
            const shortSub = p.subtext.includes("خصم") ? "خصم فوري" : p.subtext;
            this.ctx.fillText(shortSub, radius - 26, 20);
          }
        }
        this.ctx.restore();
      }

      // 2. Outer Precision Gauge Bezel
      this.ctx.beginPath();
      this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
      this.ctx.lineWidth = 4;
      this.ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      this.ctx.stroke();

      // 3. Perimeter Gauge Tick Marks (Automotive Tachometer Dial)
      const totalBezelTicks = 48;
      for (let b = 0; b < totalBezelTicks; b++) {
        const tickAngle = (b / totalBezelTicks) * Math.PI * 2;
        const isMajor = b % 6 === 0;
        const innerR = isMajor ? radius - 7 : radius - 4;
        const outerR = radius - 1;

        this.ctx.beginPath();
        this.ctx.moveTo(Math.cos(tickAngle) * innerR, Math.sin(tickAngle) * innerR);
        this.ctx.lineTo(Math.cos(tickAngle) * outerR, Math.sin(tickAngle) * outerR);
        this.ctx.lineWidth = isMajor ? 2 : 1;
        this.ctx.strokeStyle = isMajor ? "#FF5500" : "rgba(255, 255, 255, 0.35)";
        this.ctx.stroke();
      }

      this.ctx.restore();
    }

    calculateAngle(targetPrizeId) {
      let targetIndex = this.prizes.findIndex(p => p.id === targetPrizeId);
      if (targetIndex === -1) targetIndex = 0;

      // Pointer is at TOP (3 * PI / 2)
      const targetMid = (targetIndex + 0.5) * this.arc;
      const targetAngle = (3 * Math.PI / 2) - targetMid;

      const fullCircle = 2 * Math.PI;
      const normalized = (targetAngle % fullCircle + fullCircle) % fullCircle;
      const extraSpins = (6 + Math.floor(Math.random() * 2)) * fullCircle;
      return extraSpins + normalized;
    }

    spinTo(targetAngle, onComplete) {
      if (this.isSpinning) return;
      this.isSpinning = true;

      const pointer = document.getElementById("wheelPointer");
      const startAngle = this.rotation % (2 * Math.PI);
      const totalDelta = targetAngle - startAngle;
      const duration = 5000;
      const startTime = performance.now();

      // Quintic Ease-out for natural deceleration
      const easeOut = (t) => 1 - Math.pow(1 - t, 5);
      let lastTickIndex = -1;

      const animate = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const eased = easeOut(progress);

        this.rotation = startAngle + (totalDelta * eased);
        this.draw();

        // Tactile Tick Physics
        const currentTick = Math.floor((this.rotation + this.arc / 2) / this.arc);
        if (currentTick !== lastTickIndex) {
          lastTickIndex = currentTick;
          const speedFactor = 1 - progress;
          soundEngine.playTick(0.85 + speedFactor * 0.35);
          if (pointer) {
            pointer.classList.remove("is-ticking");
            void pointer.offsetWidth;
            pointer.classList.add("is-ticking");
          }
          if (navigator.vibrate) {
            try { navigator.vibrate(8); } catch (e) {}
          }
        }

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          this.isSpinning = false;
          soundEngine.playWinFanfare();
          if (navigator.vibrate) {
            try { navigator.vibrate([80, 40, 80]); } catch (e) {}
          }
          if (onComplete) onComplete();
        }
      };

      requestAnimationFrame(animate);
    }
  }

  // Display Winner & Populate Campaign Pass
  function displayWinner(prize, promo, participantData) {
    hasUserWon = true;
    currentWinningPrizeLabel = prize.label;
    const name = participantData?.name || currentParticipant?.name || 'عميل Go Wash';
    const phone = participantData?.phone || currentParticipant?.phone || '';

    // 1. Update Persistent Campaign Pass
    if (ticketBadgeText) ticketBadgeText.textContent = "تذكرة الفائز · اليوم الوطني 96";
    if (ticketKickerText) ticketKickerText.textContent = "جائزتك مع Go Wash:";
    if (ticketStatusBadge) {
      ticketStatusBadge.textContent = "مفعل وجاهز للاستخدام";
      ticketStatusBadge.className = "pass-status-pill";
    }
    if (ticketRedeemedNotice) ticketRedeemedNotice.style.display = "none";

    savedPrizeTitle.textContent = prize.label;
    savedPrizeSubtext.textContent = prize.subtext || 'خصم Go Wash على جميع باقات الغسيل المتنقل';
    savedParticipantName.textContent = name;
    if (savedParticipantPhone) savedParticipantPhone.textContent = phone;
    const savedParticipationStatus = document.getElementById("savedParticipationStatus");
    if (savedParticipationStatus) savedParticipationStatus.textContent = "تم تسجيل مشاركتك";
    savedPromoCode.textContent = promo.code;

    const bookingUrl = getWhatsAppUrl(promo.code, prize.label, prize.subtext);
    savedBookingBtn.href = bookingUrl;
    bookingCtaBtn.href = bookingUrl;

    // QR Code Display
    const qrSrc = promo.qrDataUrl || (promo.qrToken ? `${API_BASE_URL}/api/qr/${promo.qrToken}` : '');
    const savedQrWrapper = document.getElementById("savedQrWrapper");
    const savedQrCodeImg = document.getElementById("savedQrCodeImg");
    if (savedQrWrapper && savedQrCodeImg && qrSrc) {
      savedQrCodeImg.src = qrSrc;
      savedQrWrapper.style.display = "flex";
    }

    const modalQrWrapper = document.getElementById("modalQrWrapper");
    const winnerQrCodeImg = document.getElementById("winnerQrCodeImg");
    if (modalQrWrapper && winnerQrCodeImg && qrSrc) {
      winnerQrCodeImg.src = qrSrc;
      modalQrWrapper.style.display = "flex";
    }

    winnerPersistentCard.style.display = "block";
    spinBtnLabel.textContent = "تم استلام جائزتك";
    spinBtn.disabled = true;

    // 2. Save to localStorage (UX caching only, PostgreSQL is true source)
    const payload = {
      name,
      phone,
      prize: { label: prize.label, type: prize.type, subtext: prize.subtext },
      promo: {
        code: promo.code,
        status: promo.status || 'ACTIVE',
        expiresAt: promo.expiresAt,
        qrToken: promo.qrToken,
        qrDataUrl: promo.qrDataUrl
      },
      wonAt: new Date().toISOString()
    };
    try {
      localStorage.setItem("gowash_saved_prize", JSON.stringify(payload));
    } catch (e) {}

    // 3. Populate Celebration Modal (Reward Moment)
    const isSignature = (prize.type === 'UPGRADE') || (prize.label && prize.label.toUpperCase().includes('SIGNATURE'));

    if (isSignature) {
      modalPrizeCard.innerHTML = `
        <div style="display: inline-block; background: var(--gw-orange-subtle); color: var(--gw-orange); font-weight: 800; font-size: 0.8rem; padding: 2px 10px; border-radius: var(--radius-xs); margin-bottom: 8px;">الجائزة الكبرى · Signature</div>
        <div class="prize-title-custom">GOWASH SIGNATURE</div>
        <div class="prize-sub-custom">ادفع العادي واحصل على باقة Signature الفاخرة لسيارتك</div>
      `;
    } else {
      modalPrizeCard.innerHTML = `
        <div class="prize-percent-huge">${prize.label}</div>
        <div class="prize-sub-custom">${prize.subtext || 'خصم مباشر على الخدمة'}</div>
      `;
    }

    promoCodeDisplay.textContent = promo.code;

    // Open Modal and fire light celebratory confetti
    winnerModal.showModal();
    launchConfetti();
  }

  // Graceful 60fps Metallic Confetti
  function launchConfetti() {
    const canvas = document.getElementById("confettiCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";

    const colors = ["#0066FF", "#38BDF8", "#FF5500", "#FFFFFF", "#006C35"];
    const particles = [];
    const total = 90;

    for (let i = 0; i < total; i++) {
      const isLeft = i < total / 2;
      particles.push({
        x: isLeft ? 40 + Math.random() * 80 : canvas.width - (40 + Math.random() * 80),
        y: canvas.height - 30,
        vx: (isLeft ? 1 : -1) * (Math.random() * 9 + 4),
        vy: -(Math.random() * 15 + 10),
        size: Math.random() * 8 + 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 12,
        tilt: Math.random() * Math.PI,
        tiltSpeed: Math.random() * 0.1 + 0.05,
        isRibbon: Math.random() > 0.5,
        opacity: 1
      });
    }

    let start = performance.now();
    const duration = 3500;

    function render(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = false;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35;
        p.vx *= 0.985;
        p.rotation += p.rotSpeed;
        p.tilt += p.tiltSpeed;

        if (elapsed > 2400) {
          p.opacity = Math.max(0, 1 - (elapsed - 2400) / 1100);
        }

        if (p.opacity > 0 && p.y < canvas.height + 40) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;

          const scaleY = Math.cos(p.tilt);
          ctx.scale(1, scaleY);

          if (p.isRibbon) {
            ctx.fillRect(-p.size / 2, -p.size * 0.75, p.size, p.size * 1.5);
          } else {
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          }
          ctx.restore();
        }
      }

      if (alive && elapsed < duration) {
        requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = "none";
      }
    }

    requestAnimationFrame(render);
  }

  // Render Returning Customer State
  function renderReturningCustomer(res) {
    hasUserWon = true;
    currentWinningPrizeLabel = res.label || "خصم اليوم الوطني 96";
    document.body.classList.add("is-returning-customer");

    const name = res.participant?.name || res.name || currentParticipant?.name || 'عميل Go Wash';
    const phone = res.participant?.phone || res.phone || currentParticipant?.phone || '';

    if (ticketBadgeText) ticketBadgeText.textContent = "أنت شاركت بالفعل · اليوم الوطني 96";
    if (ticketKickerText) ticketKickerText.textContent = "جائزتك مع Go Wash:";
    savedPrizeTitle.textContent = res.label;
    savedPrizeSubtext.textContent = res.subtext || 'خصم Go Wash على جميع باقات الغسيل المتنقل';
    savedPromoCode.textContent = res.code || '---';
    savedParticipantName.textContent = name;
    if (savedParticipantPhone) savedParticipantPhone.textContent = phone;
    const savedParticipationStatus = document.getElementById("savedParticipationStatus");
    if (savedParticipationStatus) savedParticipationStatus.textContent = "تم تسجيل مشاركتك";

    const bookingUrl = getWhatsAppUrl(res.code, res.label, res.subtext);
    savedBookingBtn.href = bookingUrl;
    bookingCtaBtn.href = bookingUrl;

    // Server-side State Determination
    const status = res.status || 'ACTIVE';
    if (status === 'ACTIVE' || status === 'ALREADY_SPUN') {
      if (ticketStatusBadge) {
        ticketStatusBadge.textContent = "كودك نشط وجاهز للاستخدام";
        ticketStatusBadge.className = "pass-status-pill";
      }
      if (ticketRedeemedNotice) ticketRedeemedNotice.style.display = "none";
    } else if (status === 'REDEEMED') {
      if (ticketStatusBadge) {
        ticketStatusBadge.textContent = "مُستخدَم (تم الصرف)";
        ticketStatusBadge.className = "pass-status-pill redeemed";
      }
      const redeemedStr = res.redeemedAt ? new Date(res.redeemedAt).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' }) : '';
      if (ticketRedeemedNotice) {
        ticketRedeemedNotice.style.display = "block";
        ticketRedeemedNotice.className = "pass-alert-notice redeemed";
        ticketRedeemedNotice.innerHTML = `✅ تم صرف واستخدام هذه الجائزة مسبقاً لدى Go Wash ${redeemedStr ? `(بتاريخ: <strong>${redeemedStr}</strong>)` : ''}. شكراً لمشاركتك!`;
      }
    } else if (status === 'EXPIRED') {
      if (ticketStatusBadge) {
        ticketStatusBadge.textContent = "منتهي الصلاحية";
        ticketStatusBadge.className = "pass-status-pill expired";
      }
      if (ticketRedeemedNotice) {
        ticketRedeemedNotice.style.display = "block";
        ticketRedeemedNotice.className = "pass-alert-notice expired";
        ticketRedeemedNotice.innerHTML = "⏳ انتهت فترة صلاحية هذا الكود (مدة الصلاحية 48 ساعة من تاريخ الحصول عليه).";
      }
    } else if (status === 'CANCELLED') {
      if (ticketStatusBadge) {
        ticketStatusBadge.textContent = "ملغي";
        ticketStatusBadge.className = "pass-status-pill cancelled";
      }
      if (ticketRedeemedNotice) {
        ticketRedeemedNotice.style.display = "block";
        ticketRedeemedNotice.className = "pass-alert-notice cancelled";
        ticketRedeemedNotice.innerHTML = "⚠️ تم إلغاء هذا الكود من قبل الإدارة.";
      }
    }

    // QR Code display
    const qrSrc = res.qrDataUrl || (res.qrToken ? `${API_BASE_URL}/api/qr/${res.qrToken}` : '');
    const savedQrWrapper = document.getElementById("savedQrWrapper");
    const savedQrCodeImg = document.getElementById("savedQrCodeImg");
    if (savedQrWrapper && savedQrCodeImg && qrSrc) {
      savedQrCodeImg.src = qrSrc;
      savedQrWrapper.style.display = "flex";
    }

    winnerPersistentCard.style.display = "block";
    spinBtnLabel.textContent = "أنت شاركت بالفعل";
    spinBtn.disabled = true;

    try {
      localStorage.setItem("gowash_saved_prize", JSON.stringify({
        name,
        phone,
        prize: { label: res.label, type: res.type, subtext: res.subtext },
        promo: {
          code: res.code,
          status: res.status,
          expiresAt: res.expiresAt,
          redeemedAt: res.redeemedAt,
          qrToken: res.qrToken,
          qrDataUrl: res.qrDataUrl
        },
        wonAt: res.createdAt || new Date().toISOString()
      }));
    } catch (e) {}
  }

  // Check existing saved prize
  function checkExistingSavedPrize(backendParticipant) {
    if (backendParticipant && backendParticipant.hasSpun && backendParticipant.existingResult) {
      cachedExistingPrize = backendParticipant.existingResult;
      currentParticipant = {
        name: backendParticipant.existingResult?.participant?.name || 'عميل Go Wash',
        phone: backendParticipant.existingResult?.participant?.phone || ''
      };
      if (entryForm) entryForm.style.display = "none";
      if (alreadyParticipatedCard) {
        if (existingParticipantName) existingParticipantName.textContent = currentParticipant.name;
        alreadyParticipatedCard.style.display = "flex";
      }
      return true;
    }

    if (backendParticipant && !backendParticipant.hasSpun) {
      try {
        localStorage.removeItem("gowash_saved_prize");
      } catch (e) {}
      return false;
    }

    // Fallback if offline
    try {
      const localData = localStorage.getItem("gowash_saved_prize");
      if (localData) {
        const parsed = JSON.parse(localData);
        if (parsed && parsed.promo && parsed.promo.code) {
          cachedExistingPrize = {
            label: parsed.prize?.label,
            type: parsed.prize?.type,
            subtext: parsed.prize?.subtext,
            code: parsed.promo?.code,
            status: parsed.promo?.status || 'ACTIVE',
            expiresAt: parsed.promo?.expiresAt,
            redeemedAt: parsed.promo?.redeemedAt,
            qrToken: parsed.promo?.qrToken,
            qrDataUrl: parsed.promo?.qrDataUrl,
            name: parsed.name,
            phone: parsed.phone
          };
          currentParticipant = {
            name: parsed.name || 'عميل Go Wash',
            phone: parsed.phone || ''
          };
          if (entryForm) entryForm.style.display = "none";
          if (alreadyParticipatedCard) {
            if (existingParticipantName) existingParticipantName.textContent = currentParticipant.name;
            alreadyParticipatedCard.style.display = "flex";
          }
          return true;
        }
      }
    } catch (e) {}

    return false;
  }

  // Update social links
  function updateSocialLinks(links) {
    if (!links) return;
    const whats = document.getElementById("socialWhatsapp");
    const instas = document.getElementById("socialInstagram");
    const tiks = document.getElementById("socialTiktok");

    if (whats && links.whatsapp) whats.href = links.whatsapp;
    if (instas && links.instagram) instas.href = links.instagram;
    if (tiks && links.tiktok) tiks.href = links.tiktok;
  }

  // Load campaign metadata
  async function initCampaign() {
    try {
      const res = await apiFetch("/api/campaign");
      const data = await res.json();

      if (!data.success) {
        spinStatusMsg.textContent = data.error || "تعذر تحميل بيانات الفعالية.";
        spinStatusMsg.className = "spin-status-note error";
        spinBtn.disabled = true;
        return;
      }

      if (data.participantId) {
        try { localStorage.setItem("gowash_pid", data.participantId); } catch (e) {}
      }

      campaignState = data.campaign.status;
      visualPrizes = data.prizes;

      if (data.campaign.socialLinks) {
        updateSocialLinks(data.campaign.socialLinks);
      }

      wheelInstance = new VisualWheel("wheelCanvas", visualPrizes);

      if (campaignState === 'PAUSED') {
        campaignAlert.style.display = "block";
        campaignAlert.textContent = "⚠️ فعالية اليوم الوطني 96 متوقفة مؤقتاً حالياً.";
        campaignAlert.className = "campaign-alert-bar paused";
        spinBtn.disabled = true;
        return;
      }

      if (campaignState === 'ENDED') {
        campaignAlert.style.display = "block";
        campaignAlert.textContent = "🛑 انتهت فعالية اليوم الوطني السعودي 96. شكراً لكم!";
        campaignAlert.className = "campaign-alert-bar";
        spinBtn.disabled = true;
        return;
      }

      // Query PostgreSQL persistent state via GET /api/my-result
      try {
        const myRes = await apiFetch("/api/my-result");
        const myResultData = await myRes.json();
        if (myResultData && myResultData.success) {
          if (myResultData.status === 'NO_SPIN') {
            try { localStorage.removeItem("gowash_saved_prize"); } catch (e) {}
          } else {
            cachedExistingPrize = {
              label: myResultData.prize?.label,
              type: myResultData.prize?.type,
              subtext: myResultData.prize?.subtext,
              code: myResultData.promo?.code,
              status: myResultData.status,
              expiresAt: myResultData.promo?.expiresAt,
              redeemedAt: myResultData.promo?.redeemedAt,
              name: myResultData.participant?.name,
              phone: myResultData.participant?.phone
            };
            currentParticipant = {
              name: myResultData.participant?.name || 'عميل Go Wash',
              phone: myResultData.participant?.phone || ''
            };
            if (entryForm) entryForm.style.display = "none";
            if (alreadyParticipatedCard) {
              if (existingParticipantName) existingParticipantName.textContent = currentParticipant.name;
              alreadyParticipatedCard.style.display = "flex";
            }
            return;
          }
        }
      } catch (err) {
        console.warn("My-result check warning:", err);
      }

      // Fallback check from campaign payload
      checkExistingSavedPrize(data.participant);

    } catch (err) {
      console.error("Init campaign error:", err);
      spinStatusMsg.textContent = "تعذر الاتصال بالخادم. يرجى تحديث الصفحة.";
      spinStatusMsg.className = "spin-status-note error";
      spinBtn.disabled = true;
    }
  }

  // Copy code helper with clear feedback
  function setupCopyBtn(btn, textSpan, codeSourceEl) {
    btn?.addEventListener("click", async () => {
      const code = codeSourceEl.textContent.trim();
      if (!code || code.includes('XXXX') || code === '--------') return;
      try {
        await navigator.clipboard.writeText(code);
        if (navigator.vibrate) {
          try { navigator.vibrate(30); } catch (e) {}
        }
        showToast("تم نسخ الكود");
        if (textSpan) {
          const original = textSpan.textContent;
          textSpan.textContent = "تم النسخ!";
          setTimeout(() => { textSpan.textContent = original; }, 2000);
        }
      } catch (e) {
        showToast("تم نسخ الكود");
      }
    });
  }

  setupCopyBtn(copyCodeBtn, copyBtnText, promoCodeDisplay);
  setupCopyBtn(copySavedCodeBtn, copySavedCodeText, savedPromoCode);

  // Social Sharing
  async function shareWinner(prizeLabel) {
    const prize = prizeLabel || currentWinningPrizeLabel || "خصماً حصرياً";
    const shareText = `ربحت ${prize} مع Go Wash في فعالية اليوم الوطني 96! 🚗✨ جرب حظك الآن:`;
    const shareUrl = window.location.origin + window.location.pathname;

    apiFetch("/api/share-event", {
      method: "POST",
      body: JSON.stringify({
        channel: navigator.share ? "native_share" : "clipboard_copy",
        promoCode: promoCodeDisplay ? promoCodeDisplay.textContent : null
      })
    }).catch(() => {});

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Go Wash — فعالية اليوم الوطني السعودي 96",
          text: shareText,
          url: shareUrl
        });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      showToast("تم نسخ نص المشاركة بنجاح! شاركه الآن مع أصدقائك.");
    } catch (err) {
      showToast("تم نسخ رابط الفعالية لمشاركته مع أصدقائك.");
    }
  }

  shareResultBtn?.addEventListener("click", () => shareWinner(currentWinningPrizeLabel));
  savedShareBtn?.addEventListener("click", () => shareWinner(savedPrizeTitle ? savedPrizeTitle.textContent : ""));

  // How to use scroll helper
  function scrollToHowToUse() {
    if (winnerModal && winnerModal.open) {
      winnerModal.close();
    }
    if (howToUseSection) {
      howToUseSection.scrollIntoView({ behavior: "smooth" });
    }
  }

  savedHowToUseBtn?.addEventListener("click", scrollToHowToUse);
  modalHowToUseBtn?.addEventListener("click", scrollToHowToUse);

  // Modal Closers
  modalCloseBtn?.addEventListener("click", () => winnerModal.close());
  termsCloseIcon?.addEventListener("click", () => termsModal.close());
  recoverCloseBtn?.addEventListener("click", () => recoverModal.close());

  // Decline Terms ("رفض")
  declineTermsBtn?.addEventListener("click", () => {
    termsModal.close();
    showToast("يلزمك الموافقة على الشروط والأحكام للمشاركة في الفعالية.");
  });

  // Transition to Spin Screen Helper
  function transitionToSpinScreen(name, callback) {
    if (entryScreenSection) entryScreenSection.style.display = "none";
    if (spinScreenSection) {
      spinScreenSection.style.display = "flex";
      if (spinGreetingTitle && name) {
        spinGreetingTitle.textContent = `أهلًا ${name}، وش راح تربح؟`;
      }
    }
    if (typeof callback === "function") callback();
  }

  // 1. Entry Form Handler
  async function handleEntrySubmit() {
    if (entryNameError) entryNameError.textContent = "";
    if (entryPhoneError) entryPhoneError.textContent = "";
    entryNameInput?.classList.remove("is-invalid");
    entryPhoneInput?.closest(".phone-input-wrap")?.classList.remove("is-invalid");

    const rawName = entryNameInput?.value?.trim() || "";
    if (rawName.length < 2) {
      if (entryNameError) entryNameError.textContent = "يرجى إدخال اسمك الكريم (حرفين على الأقل).";
      entryNameInput?.classList.add("is-invalid");
      entryNameInput?.focus();
      return;
    }

    const rawPhone = entryPhoneInput?.value?.trim() || "";
    const phone = normalizeSaudiPhone(rawPhone);
    if (!phone) {
      if (entryPhoneError) entryPhoneError.textContent = "يرجى إدخال رقم جوال سعودي صحيح يبدأ بـ 05 (10 أرقام).";
      entryPhoneInput?.closest(".phone-input-wrap")?.classList.add("is-invalid");
      entryPhoneInput?.focus();
      return;
    }

    if (entrySubmitBtn) entrySubmitBtn.disabled = true;
    if (entryBtnLabel) entryBtnLabel.textContent = "جاري التحقق...";

    try {
      const res = await apiFetch("/api/participant/entry", {
        method: "POST",
        body: JSON.stringify({ name: rawName, phone })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (entrySubmitBtn) entrySubmitBtn.disabled = false;
        if (entryBtnLabel) entryBtnLabel.textContent = "دخول الفعالية";
        const errMsg = data.error || data.message || "تعذر تسجيل الدخول، يرجى المحاولة لاحقاً.";
        if (errMsg.includes("جوال") || errMsg.includes("الهاتف") || errMsg.includes("phone")) {
          if (entryPhoneError) entryPhoneError.textContent = errMsg;
          entryPhoneInput?.closest(".phone-input-wrap")?.classList.add("is-invalid");
        } else {
          if (entryNameError) entryNameError.textContent = errMsg;
          entryNameInput?.classList.add("is-invalid");
        }
        return;
      }

      const participantName = data.participant?.name || rawName;
      const participantPhone = data.participant?.phone || phone;

      currentParticipant = {
        name: participantName,
        phone: participantPhone
      };

      // If participant has already spun in this campaign
      if (data.alreadyParticipated) {
        cachedExistingPrize = data.existingPrize || data.existingResult;
        if (entryForm) entryForm.style.display = "none";
        if (alreadyParticipatedCard) {
          if (existingParticipantName) existingParticipantName.textContent = participantName;
          alreadyParticipatedCard.style.display = "flex";
        }
        return;
      }

      // New participant: Transition state
      if (entryForm) entryForm.style.display = "none";
      if (entryTransitionCard) {
        if (transitionParticipantName) transitionParticipantName.textContent = participantName;
        entryTransitionCard.style.display = "flex";
      }

      setTimeout(() => {
        transitionToSpinScreen(participantName);
      }, 700);

    } catch (err) {
      console.error("Entry error:", err);
      if (entrySubmitBtn) entrySubmitBtn.disabled = false;
      if (entryBtnLabel) entryBtnLabel.textContent = "دخول الفعالية";
      if (entryNameError) entryNameError.textContent = "حدث خطأ في الاتصال، يرجى إعادة المحاولة.";
    }
  }

  // View Existing Prize Click
  viewMyPrizeBtn?.addEventListener("click", () => {
    transitionToSpinScreen(currentParticipant?.name || "", () => {
      if (cachedExistingPrize) {
        renderReturningCustomer(cachedExistingPrize);
      }
      winnerPersistentCard?.scrollIntoView({ behavior: "smooth" });
    });
  });

  // Entry Form Inputs
  entryNameInput?.addEventListener("input", () => {
    if (entryNameError) entryNameError.textContent = "";
    entryNameInput.classList.remove("is-invalid");
  });

  entryPhoneInput?.addEventListener("input", () => {
    if (entryPhoneError) entryPhoneError.textContent = "";
    entryPhoneInput.closest(".phone-input-wrap")?.classList.remove("is-invalid");
  });

  entryNameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      entryPhoneInput?.focus();
    }
  });

  entryPhoneInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleEntrySubmit();
    }
  });

  entrySubmitBtn?.addEventListener("click", handleEntrySubmit);

  // 2. Open Terms Modal on Spin Button Click
  spinBtn?.addEventListener("click", () => {
    if (hasUserWon) {
      winnerPersistentCard?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (!wheelInstance || wheelInstance.isSpinning) return;
    if (campaignState !== 'ACTIVE') return;

    termsModal?.showModal();
  });

  // 3. Agree to Terms & Execute Atomic Spin
  async function handleAgreeAndSpin() {
    termsModal?.close();

    spinBtn.disabled = true;
    spinBtnLabel.textContent = "جاري السحب...";
    spinStatusMsg.textContent = "جاري تجهيز جائزتك...";
    spinStatusMsg.className = "spin-status-note";

    let idempotencyKey = sessionStorage.getItem("gowash_idempotency_key");
    if (!idempotencyKey) {
      idempotencyKey = "idemp_" + Math.random().toString(36).substring(2) + Date.now();
      sessionStorage.setItem("gowash_idempotency_key", idempotencyKey);
    }

    const name = currentParticipant?.name || 'عميل Go Wash';
    const phone = currentParticipant?.phone || '';

    try {
      // Step 1: Record Consent
      try {
        await apiFetch("/api/consent", {
          method: "POST",
          body: JSON.stringify({
            termsAccepted: true,
            termsVersion: currentTermsVersion,
            name,
            phone
          })
        });
      } catch (consentErr) {
        console.warn("Consent recording notice:", consentErr);
      }

      // Step 2: Atomic Spin
      const response = await apiFetch("/api/spin", {
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({
          idempotencyKey,
          termsAccepted: true,
          termsVersion: currentTermsVersion,
          name,
          phone
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        spinBtn.disabled = false;
        spinBtnLabel.textContent = "لف واربح";
        const errMsg = data.message || data.error || "حدث خطأ أثناء السحب.";
        spinStatusMsg.textContent = errMsg;
        spinStatusMsg.className = "spin-status-note error";

        if (data.code === 'ALREADY_SPUN') {
          spinBtn.disabled = true;
          spinBtnLabel.textContent = "أنت شاركت بالفعل";
          if (data.existingPrize) {
            renderReturningCustomer(data.existingPrize);
          }
        }
        return;
      }

      // Success: Spin the wheel to the exact sector
      spinStatusMsg.textContent = "مبروك! العجلة تدور الآن...";
      sessionStorage.removeItem("gowash_idempotency_key");

      const targetAngle = wheelInstance.calculateAngle(data.prize.id);

      wheelInstance.spinTo(targetAngle, () => {
        displayWinner(data.prize, data.promo, { name: data.participant?.name || name, phone: data.participant?.phone || phone });
        spinStatusMsg.textContent = "";
      });

    } catch (err) {
      console.error("Spin error:", err);
      spinBtn.disabled = false;
      spinBtnLabel.textContent = "لف واربح";
      spinStatusMsg.textContent = "فشل الاتصال بالخادم. يرجى المحاولة مجدداً.";
      spinStatusMsg.className = "spin-status-note error";
    }
  }

  agreeAndSpinBtn?.addEventListener("click", handleAgreeAndSpin);

  // Recover Prize Modal Handlers
  openRecoverModalBtn?.addEventListener("click", () => {
    recoverErrorMsg.textContent = "";
    recoverPhoneInput.value = "";
    recoverModal.showModal();
  });

  submitRecoverBtn?.addEventListener("click", async () => {
    const raw = recoverPhoneInput.value.trim();
    const phone = normalizeSaudiPhone(raw);
    if (!phone) {
      recoverErrorMsg.textContent = "يرجى إدخال رقم جوال سعودي صحيح (05xxxxxxxx).";
      return;
    }
    recoverErrorMsg.textContent = "جاري البحث عن جائزتك...";

    try {
      const res = await apiFetch("/api/check-prize", {
        method: "POST",
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        recoverErrorMsg.textContent = data.message || data.error || "لا توجد جائزة مسجلة بهذا الرقم.";
        return;
      }

      recoverModal.close();
      renderReturningCustomer({
        label: data.prize.label,
        type: data.prize.type,
        subtext: data.prize.subtext,
        code: data.promo.code,
        status: data.promo.status || 'ACTIVE',
        expiresAt: data.promo.expiresAt,
        redeemedAt: data.promo.redeemedAt,
        createdAt: data.promo.createdAt,
        qrToken: data.promo.qrToken,
        qrDataUrl: data.promo.qrDataUrl,
        participant: data.participant
      });
      showToast("تم استرجاع جائزتك بنجاح!");
    } catch (e) {
      recoverErrorMsg.textContent = "حدث خطأ أثناء الاتصال. يرجى المحاولة لاحقاً.";
    }
  });

  // Start initialization
  initCampaign();
});
