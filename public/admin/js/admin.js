document.addEventListener("DOMContentLoaded", () => {
  let csrfToken = sessionStorage.getItem("gowash_csrf_token") || "";
  let currentTab = "overview";
  let spinsPage = 1;
  let promosPage = 1;
  let currentPrizes = [];

  // Toast Notification
  const toast = document.getElementById("toastMsg");
  function showToast(message, type = "success") {
    toast.textContent = message;
    toast.className = `toast-msg ${type}`;
    toast.style.display = "block";
    setTimeout(() => { toast.style.display = "none"; }, 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }

  // Safe fetch wrapper with CSRF token
  async function fetchWithCsrf(url, options = {}) {
    options.headers = options.headers || {};
    if (csrfToken && !options.headers["x-csrf-token"]) {
      options.headers["x-csrf-token"] = csrfToken;
    }
    const res = await fetch(url, options);
    if (res.status === 401) {
      window.location.href = "/admin/login.html";
      throw new Error("Unauthorized");
    }
    return res;
  }

  // Verify Admin Session
  async function checkAuth() {
    try {
      const res = await fetchWithCsrf("/api/admin/me");
      if (!res.ok) throw new Error("Not logged in");
      const data = await res.json();
      if (data.success && data.user) {
        document.getElementById("adminNameDisplay").textContent = data.user.username;
        csrfToken = data.csrfToken;
        sessionStorage.setItem("gowash_csrf_token", csrfToken);
        loadCurrentTab();
      }
    } catch (err) {
      window.location.href = "/admin/login.html";
    }
  }

  // Tab Navigation
  const tabButtons = document.querySelectorAll(".sidebar-nav .nav-item");
  const tabPanels = document.querySelectorAll(".tab-panel");
  const topbarTitle = document.getElementById("topbarTitle");

  const tabTitles = {
    overview: "نظرة عامة على الفعالية",
    "quick-redeem": "التحقق والاسترداد السريع للجوائز",
    campaign: "إدارة إعدادات ومواعيد الحملة",
    prizes: "إدارة الجوائز ونسب الاحتمالات",
    spins: "سجل تدوير العملاء والنتائج",
    promos: "إدارة وفحص الأكواد الترويجية",
    security: "شاشة الأمان والأحداث المشبوهة",
    audit: "سجل العمليات الإدارية (Audit Trail)",
    settings: "إعدادات الأمان وكلمة المرور"
  };

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      if (target === currentTab) return;

      tabButtons.forEach(b => b.classList.remove("active"));
      tabPanels.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const panel = document.getElementById(`panel-${target}`);
      if (panel) panel.classList.add("active");

      currentTab = target;
      topbarTitle.textContent = tabTitles[target] || "لوحة التحكم";
      if (window.innerWidth <= 768) {
        document.querySelector(".sidebar")?.classList.remove("is-open");
      }
      loadCurrentTab();
    });
  });

  const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
  const sidebar = document.querySelector(".sidebar");
  if (sidebarToggleBtn && sidebar) {
    sidebarToggleBtn.addEventListener("click", () => {
      sidebar.classList.toggle("is-open");
    });
  }

  function loadCurrentTab() {
    switch (currentTab) {
      case "overview": loadOverview(); break;
      case "quick-redeem": focusQuickRedeem(); break;
      case "campaign": loadCampaign(); break;
      case "prizes": loadPrizes(); break;
      case "spins": loadSpins(spinsPage); break;
      case "promos": loadPromos(promosPage); break;
      case "security": loadSecurity(); break;
      case "audit": loadAudit(); break;
    }
  }

  // 1. Overview Loader
  async function loadOverview() {
    try {
      const res = await fetchWithCsrf("/api/admin/overview");
      const data = await res.json();
      if (!data.success) return;

      const s = data.stats;
      document.getElementById("statTotalSpins").textContent = s.totalSpins.toLocaleString();
      document.getElementById("statUniqueParticipants").textContent = s.uniqueParticipants.toLocaleString();
      document.getElementById("statRewardsIssued").textContent = s.rewardsIssued.toLocaleString();
      document.getElementById("statActiveCodes").textContent = s.activeCodes.toLocaleString();
      document.getElementById("statRedeemedCodes").textContent = s.redeemedCodes.toLocaleString();
      document.getElementById("statExpiredCodes").textContent = s.expiredCodes.toLocaleString();
      document.getElementById("statBlockedRequests").textContent = s.blockedRequests.toLocaleString();

      const badge = document.getElementById("overviewCampaignBadge");
      const status = data.campaign.status;
      if (status === 'ACTIVE') {
        badge.innerHTML = `<span class="badge badge-active">الحملة نشطة وجارية حالياً</span>`;
      } else if (status === 'PAUSED') {
        badge.innerHTML = `<span class="badge badge-paused">الحملة متوقفة مؤقتاً (Kill Switch مفعل)</span>`;
      } else {
        badge.innerHTML = `<span class="badge badge-cancelled">الحملة منتهية مغلقة</span>`;
      }
    } catch (err) {
      console.error("Error loading overview:", err);
    }
  }

  // Quick Lookup & Instant Redeem Handler on Overview
  function initQuickLookup() {
    const input = document.getElementById("quickLookupInput");
    const btn = document.getElementById("quickLookupBtn");
    const resultBox = document.getElementById("quickLookupResult");

    if (!input || !btn || !resultBox) return;

    window.currentQuickLookupCode = null;

    async function doLookup(termOverride) {
      const term = (typeof termOverride === "string" && termOverride) ? termOverride : input.value.trim();
      if (!term) {
        showToast("يرجى إدخال كود الخصم أو رقم الجوال للتحقق", "error");
        return;
      }
      btn.disabled = true;
      btn.textContent = "جاري التحقق...";
      resultBox.style.display = "block";
      resultBox.innerHTML = `<div style="color: var(--admin-soft); padding: 10px;">جاري فحص وتأكيد بيانات الكود...</div>`;

      try {
        const res = await fetchWithCsrf(`/api/admin/promos/lookup?term=${encodeURIComponent(term)}`);
        const data = await res.json();
        btn.disabled = false;
        btn.textContent = "تحقق";

        if (!res.ok || !data.success || !data.promo) {
          resultBox.innerHTML = `
            <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #FCA5A5; padding: 14px 18px; border-radius: var(--radius-md);">
              ❌ ${escapeHtml(data.error || "لم يتم العثور على أي كود مطابق")}
            </div>
          `;
          return;
        }

        const p = data.promo;
        window.currentQuickLookupCode = p.code;

        const createdStr = new Date(p.created_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
        const expiresStr = p.expires_at ? new Date(p.expires_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }) : "غير محدد";
        const redeemedStr = p.redeemed_at ? new Date(p.redeemed_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }) : "--- (لم يُسترد بعد)";

        let statusBadge = "";
        if (p.status === 'ACTIVE') {
          statusBadge = `<span class="badge badge-active" style="font-size: 0.95rem; padding: 6px 14px;">نشط (ACTIVE)</span>`;
        } else if (p.status === 'REDEEMED') {
          statusBadge = `<span class="badge badge-redeemed" style="font-size: 0.95rem; padding: 6px 14px;">مُسترد (REDEEMED)</span>`;
        } else if (p.status === 'CANCELLED') {
          statusBadge = `<span class="badge badge-cancelled" style="font-size: 0.95rem; padding: 6px 14px;">ملغي (CANCELLED)</span>`;
        } else {
          statusBadge = `<span class="badge badge-expired" style="font-size: 0.95rem; padding: 6px 14px;">منتهي الصلاحية (EXPIRED)</span>`;
        }

        resultBox.innerHTML = `
          <div style="background: rgba(14, 34, 56, 0.95); border: 1px solid rgba(29, 111, 184, 0.4); border-radius: var(--radius-md); padding: 20px; box-shadow: 0 4px 14px rgba(0,0,0,0.3);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
              <div>
                <span style="font-size: 0.8rem; color: var(--admin-muted); display: block;">الكود الترويجي</span>
                <span style="font-family: monospace; font-size: 1.45rem; font-weight: 900; color: #72F3AA; letter-spacing: 1px;">${escapeHtml(p.code)}</span>
              </div>
              <div>${statusBadge}</div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; font-size: 0.9rem;">
              <div>👤 <strong>المشارك:</strong> <span>${escapeHtml(p.participant_name || 'غير محدد')}</span> <span dir="ltr" style="font-family: monospace; color: #60A5FA;">(${escapeHtml(p.participant_phone || '---')})</span></div>
              <div>🎁 <strong>الجائزة:</strong> <strong style="color: #FCD34D;">${escapeHtml(p.prize_label)}</strong> <span style="font-size: 0.82rem; color: var(--admin-soft);">${escapeHtml(p.prize_subtext || '')}</span></div>
              <div>📅 <strong>تاريخ اللفة:</strong> <span>${createdStr}</span></div>
              <div>⏳ <strong>تاريخ الانتهاء:</strong> <span>${expiresStr}</span></div>
              <div>✅ <strong>تاريخ الاسترداد:</strong> <span style="color: ${p.redeemed_at ? '#10B981' : 'var(--admin-muted)'}; font-weight: ${p.redeemed_at ? 'bold' : 'normal'};">${redeemedStr}</span></div>
            </div>

            <div style="display: flex; gap: 10px; flex-wrap: wrap; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 14px;">
              ${p.status === 'ACTIVE' ? `
                <button type="button" class="btn-primary" style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); font-size: 0.95rem; padding: 8px 22px; font-weight: 800;" onclick="window.redeemCode('${escapeHtml(p.code)}', '${escapeHtml(p.participant_name || '')}')">
                  استرداد الجائزة ✅
                </button>
              ` : ''}
              ${p.status === 'REDEEMED' ? `
                <button type="button" class="btn-action-sm" style="background: rgba(245, 158, 11, 0.2); color: #FBBF24; border: 1px solid #F59E0B; padding: 7px 16px; font-size: 0.88rem;" onclick="window.unredeemCode('${escapeHtml(p.code)}')">
                  ↩️ إلغاء الاسترداد وإعادة كنشط
                </button>
              ` : ''}
              ${p.status !== 'CANCELLED' ? `
                <button type="button" class="btn-action-sm cancel" style="padding: 7px 16px; font-size: 0.88rem;" onclick="window.cancelCode('${escapeHtml(p.code)}')">
                  🚫 إلغاء الكود
                </button>
              ` : ''}
            </div>
          </div>
        `;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "تحقق";
        resultBox.innerHTML = `<div style="color: #F87171;">حدث خطأ في الاتصال بالخادم.</div>`;
      }
    }

    btn.addEventListener("click", () => doLookup());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doLookup();
      }
    });

    window.doQuickLookup = (term) => doLookup(term);
  }

  // -------------------------------------------------------------
  // Dedicated Quick Verification & Instant Redemption Tab
  // -------------------------------------------------------------
  function initQuickRedeemTab() {
    const input = document.getElementById("quickRedeemInput");
    const verifyBtn = document.getElementById("quickRedeemBtn");
    const clearBtn = document.getElementById("quickRedeemClearBtn");
    const fileInput = document.getElementById("quickRedeemFileInput");
    const resultBox = document.getElementById("quickRedeemResultBox");

    const modal = document.getElementById("quickRedeemConfirmModal");
    const confirmPrize = document.getElementById("quickConfirmPrize");
    const confirmCode = document.getElementById("quickConfirmCode");
    const confirmCancelBtn = document.getElementById("quickConfirmCancelBtn");
    const confirmSubmitBtn = document.getElementById("quickConfirmSubmitBtn");

    if (!input || !verifyBtn || !resultBox) return;

    let activePromoData = null;

    input.addEventListener("input", () => {
      if (clearBtn) clearBtn.style.display = input.value.trim() ? "inline-flex" : "none";
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        input.value = "";
        clearBtn.style.display = "none";
        resultBox.style.display = "none";
        activePromoData = null;
        input.focus();
      });
    }

    async function executeVerification(termOverride) {
      const term = (typeof termOverride === "string" && termOverride) ? termOverride.trim() : input.value.trim();
      if (!term) {
        showToast("يرجى إدخال كود الخصم أو مسح رمز QR", "error");
        input.focus();
        return;
      }

      verifyBtn.disabled = true;
      verifyBtn.textContent = "جاري التحقق...";
      resultBox.style.display = "block";
      resultBox.innerHTML = `
        <div style="background: rgba(8, 22, 36, 0.8); border: 1px solid var(--admin-border); border-radius: var(--radius-md); padding: 30px; text-align: center; color: var(--admin-soft);">
          <div style="font-size: 1.5rem; margin-bottom: 8px;">⏳</div>
          <div style="font-weight: 700;">جاري مطابقة وفحص الكود لحظياً مع قاعدة البيانات...</div>
        </div>
      `;

      try {
        const res = await fetchWithCsrf(`/api/admin/verify/${encodeURIComponent(term)}`);
        const data = await res.json();
        verifyBtn.disabled = false;
        verifyBtn.textContent = "تحقق من الكود 🔍";

        if (!res.ok || !data.success) {
          activePromoData = null;
          resultBox.innerHTML = `
            <div style="background: rgba(239, 68, 68, 0.15); border: 2px solid #EF4444; color: #FCA5A5; padding: 22px; border-radius: var(--radius-md); text-align: center;">
              <div style="font-size: 1.8rem; margin-bottom: 6px;">❌</div>
              <div style="font-size: 1.1rem; font-weight: 900;">${escapeHtml(data.error || "الكود المدخل غير صالح أو غير موجود")}</div>
              <div style="font-size: 0.85rem; color: var(--admin-muted); margin-top: 6px;">تأكد من كتابة الكود بشكل سليم أو مسح رمز الـ QR الصحيح.</div>
            </div>
          `;
          return;
        }

        activePromoData = data;
        renderQuickResultCard(data);
      } catch (err) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = "تحقق من الكود 🔍";
        resultBox.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid #EF4444; color: #FCA5A5; padding: 18px; border-radius: var(--radius-md); text-align: center;">
            ⚠️ تعذر الاتصال بالخادم، يرجى المحاولة مجدداً.
          </div>
        `;
      }
    }

    function renderQuickResultCard(data) {
      const status = data.status || 'EXPIRED';
      const statusClass = `status-${status.toLowerCase()}`;

      let statusColor = '#10B981';
      let statusBg = 'rgba(16, 185, 129, 0.15)';
      let statusLabel = 'نشط وجاهز للاستخدام (ACTIVE)';
      if (status === 'REDEEMED') {
        statusColor = '#3B82F6';
        statusBg = 'rgba(59, 130, 246, 0.15)';
        statusLabel = 'تم استخدام هذه الجائزة مسبقاً (REDEEMED)';
      } else if (status === 'EXPIRED') {
        statusColor = '#94A3B8';
        statusBg = 'rgba(148, 163, 184, 0.15)';
        statusLabel = 'انتهت صلاحية هذه الجائزة (EXPIRED)';
      } else if (status === 'CANCELLED') {
        statusColor = '#EF4444';
        statusBg = 'rgba(239, 68, 68, 0.15)';
        statusLabel = 'هذه الجائزة ملغاة (CANCELLED)';
      }

      const createdStr = data.dates?.createdAt || '---';
      const expiresStr = data.dates?.expiresAt || '---';
      const redeemedStr = data.dates?.redeemedAt || null;
      const redeemedByStr = data.dates?.redeemedBy || null;

      const participantName = data.participant?.name || 'عميل Go Wash';
      const participantPhone = data.participant?.phone || '';

      let actionAreaHtml = '';
      if (status === 'ACTIVE') {
        actionAreaHtml = `
          <div style="margin-top: 20px;">
            <button type="button" id="triggerRedeemBtn" class="quick-redeem-btn-huge">
              ✅ استرداد الجائزة
            </button>
          </div>
        `;
      } else if (status === 'REDEEMED') {
        actionAreaHtml = `
          <div style="margin-top: 18px; padding: 14px 18px; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: var(--radius-sm); color: #93C5FD; font-size: 0.95rem;">
            ℹ️ <strong>تم الصرف مسبقاً:</strong> صُرفت بتاريخ <strong>${escapeHtml(redeemedStr || 'مسبقاً')}</strong> ${redeemedByStr ? `بواسطة: <strong>${escapeHtml(redeemedByStr)}</strong>` : ''}.
          </div>
        `;
      } else if (status === 'EXPIRED') {
        actionAreaHtml = `
          <div style="margin-top: 18px; padding: 14px 18px; background: rgba(148, 163, 184, 0.12); border: 1px solid rgba(148, 163, 184, 0.35); border-radius: var(--radius-sm); color: #CBD5E1; font-size: 0.95rem;">
            ⏳ <strong>منتهية الصلاحية:</strong> انتهت صلاحية هذا الكود بتاريخ <strong>${escapeHtml(expiresStr)}</strong> ولا يمكن صرفه.
          </div>
        `;
      } else if (status === 'CANCELLED') {
        actionAreaHtml = `
          <div style="margin-top: 18px; padding: 14px 18px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: var(--radius-sm); color: #FCA5A5; font-size: 0.95rem;">
            🚫 <strong>جائزة ملغاة:</strong> تم إلغاء هذه الجائزة من قبل الإدارة ولا يمكن استردادها.
          </div>
        `;
      }

      resultBox.innerHTML = `
        <div class="quick-result-card ${statusClass}">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
            <div>
              <span style="font-size: 0.8rem; color: var(--admin-muted); display: block;">الكود الترويجي</span>
              <span style="font-family: monospace; font-size: 1.6rem; font-weight: 900; color: #72F3AA; letter-spacing: 1px;">
                ${escapeHtml(data.code)}
              </span>
            </div>
            <div style="display: inline-block; padding: 6px 16px; border-radius: 9999px; background: ${statusBg}; color: ${statusColor}; font-weight: 900; font-size: 0.92rem; border: 1px solid ${statusColor};">
              ${escapeHtml(statusLabel)}
            </div>
          </div>

          <div style="background: rgba(0,0,0,0.25); border-radius: var(--radius-sm); padding: 16px; margin-bottom: 16px;">
            <div style="font-size: 1.3rem; font-weight: 900; color: #FCD34D; margin-bottom: 4px;">
              🎁 ${escapeHtml(data.prize?.label || 'جائزة Go Wash')}
            </div>
            <div style="font-size: 0.9rem; color: var(--admin-soft);">
              ${escapeHtml(data.prize?.subtext || 'خصم اليوم الوطني 96 من Go Wash')}
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size: 0.88rem; color: #E2E8F0;">
            <div>👤 <strong>المستفيد:</strong> <span>${escapeHtml(participantName)}</span></div>
            ${participantPhone ? `<div>📱 <strong>الجوال:</strong> <span dir="ltr" style="font-family: monospace; color: #60A5FA;">${escapeHtml(participantPhone)}</span></div>` : ''}
            <div>📅 <strong>تاريخ الإنشاء:</strong> <span>${escapeHtml(createdStr)}</span></div>
            <div>⏳ <strong>تاريخ الانتهاء:</strong> <span>${escapeHtml(expiresStr)}</span></div>
            ${redeemedStr ? `<div style="grid-column: 1 / -1; color: #60A5FA;">✅ <strong>تاريخ الاسترداد:</strong> <span>${escapeHtml(redeemedStr)}</span> ${redeemedByStr ? `(بواسطة: ${escapeHtml(redeemedByStr)})` : ''}</div>` : ''}
          </div>

          ${actionAreaHtml}
        </div>
      `;

      // Attach redeem button click handler
      const triggerBtn = document.getElementById("triggerRedeemBtn");
      if (triggerBtn) {
        triggerBtn.addEventListener("click", () => {
          confirmPrize.textContent = data.prize?.label || '';
          confirmCode.textContent = data.code;
          if (modal) {
            modal.showModal();
          }
        });
      }
    }

    // Modal Action Handlers
    if (confirmCancelBtn && modal) {
      confirmCancelBtn.addEventListener("click", () => {
        modal.close();
      });
    }

    if (confirmSubmitBtn && modal) {
      confirmSubmitBtn.addEventListener("click", async () => {
        if (!activePromoData) return;
        confirmSubmitBtn.disabled = true;
        confirmSubmitBtn.textContent = "جاري التأكيد...";

        try {
          const res = await fetchWithCsrf(`/api/admin/promos/${encodeURIComponent(activePromoData.code)}/redeem`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          const data = await res.json();
          confirmSubmitBtn.disabled = false;
          confirmSubmitBtn.textContent = "تأكيد الاسترداد ✅";
          modal.close();

          if (!res.ok || !data.success) {
            showToast(data.error || "فشل استرداد الجائزة", "error");
            return;
          }

          showToast("✅ تم استرداد وصرف الجائزة بنجاح!", "success");

          // Instant re-verify to show updated status
          await executeVerification(activePromoData.code);

          // Update Overview if tab is visited later
          loadOverview();
        } catch (err) {
          confirmSubmitBtn.disabled = false;
          confirmSubmitBtn.textContent = "تأكيد الاسترداد ✅";
          modal.close();
          showToast("حدث خطأ أثناء استرداد الجائزة", "error");
        }
      });
    }

    // Input keyboard trigger
    verifyBtn.addEventListener("click", () => executeVerification());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        executeVerification();
      }
    });

    // Barcode / Camera File Input Support
    if (fileInput) {
      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if ('BarcodeDetector' in window) {
          try {
            const detector = new BarcodeDetector({ formats: ['qr_code'] });
            const bitmap = await createImageBitmap(file);
            const barcodes = await detector.detect(bitmap);
            if (barcodes && barcodes.length > 0) {
              const code = barcodes[0].rawValue;
              input.value = code;
              if (clearBtn) clearBtn.style.display = "inline-flex";
              executeVerification(code);
              return;
            }
          } catch (err) {
            console.warn("BarcodeDetector error:", err);
          }
        }
        showToast("يرجى إدخال كود الخصم الظاهر في البطاقة أو كتابته يدوياً", "info");
      });
    }

    window.verifyAdminPromo = (code) => {
      input.value = code;
      if (clearBtn) clearBtn.style.display = "inline-flex";
      executeVerification(code);
    };
  }

  function focusQuickRedeem() {
    const input = document.getElementById("quickRedeemInput");
    if (input) {
      setTimeout(() => input.focus(), 150);
    }
  }

  // 2. Campaign Settings
  async function loadCampaign() {
    try {
      const res = await fetchWithCsrf("/api/admin/campaign");
      const data = await res.json();
      if (!data.success) return;

      const c = data.campaign;
      document.getElementById("campaignStatusSelect").value = c.status;
      document.getElementById("campaignNameInput").value = c.name;
      document.getElementById("campaignStartDateInput").value = c.start_date ? c.start_date.substring(0, 16) : "";
      document.getElementById("campaignEndDateInput").value = c.end_date ? c.end_date.substring(0, 16) : "";
    } catch (err) {
      console.error("Error loading campaign:", err);
    }
  }

  document.getElementById("campaignSettingsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("campaignStatusSelect").value;
    const name = document.getElementById("campaignNameInput").value.trim();
    const start_date = document.getElementById("campaignStartDateInput").value;
    const end_date = document.getElementById("campaignEndDateInput").value;

    try {
      const res = await fetchWithCsrf("/api/admin/campaign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, name, start_date, end_date })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "فشل حفظ إعدادات الحملة", "error");
        return;
      }
      showToast("تم تحديث إعدادات الحملة بنجاح.");
    } catch (err) {
      showToast("حدث خطأ في الاتصال", "error");
    }
  });

  // Kill Switch Action
  async function triggerKillSwitch() {
    if (!confirm("هل أنت متأكد من إيقاف الفعالية فورياً؟ سيتم رفض أي طلبات تدوير جديدة فوراً.")) return;
    try {
      const res = await fetchWithCsrf("/api/admin/kill-switch", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("تم إيقاف الفعالية فورياً (Kill Switch)!", "error");
        loadOverview();
        if (currentTab === "campaign") loadCampaign();
      }
    } catch (err) {
      showToast("فشل تفعيل الإيقاف الفوري", "error");
    }
  }

  document.getElementById("topbarKillSwitch")?.addEventListener("click", triggerKillSwitch);

  // 3. Prizes & Probabilities Loader
  async function loadPrizes() {
    try {
      const res = await fetchWithCsrf("/api/admin/prizes");
      const data = await res.json();
      if (!data.success) return;

      currentPrizes = data.prizes;
      renderPrizesTable();
    } catch (err) {
      console.error("Error loading prizes:", err);
    }
  }

  function renderPrizesTable() {
    const tbody = document.getElementById("prizesTableBody");
    tbody.innerHTML = "";

    currentPrizes.forEach(p => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td><strong style="color: var(--admin-accent); font-family: monospace;">${p.id}</strong></td>
        <td>
          <input type="text" class="form-input prize-label-input" data-id="${p.id}" value="${p.label}" style="padding: 6px 10px;">
        </td>
        <td>
          <input type="text" class="form-input prize-subtext-input" data-id="${p.id}" value="${p.subtext}" style="padding: 6px 10px;">
        </td>
        <td>
          <input type="number" step="0.1" min="0" max="100" class="form-input prize-prob-input" data-id="${p.id}" value="${p.probability}" style="padding: 6px 10px; font-weight: 800; font-feature-settings: 'tnum';">
        </td>
        <td>
          <select class="form-select prize-active-select" data-id="${p.id}" style="padding: 6px 10px;">
            <option value="1" ${p.is_active ? 'selected' : ''}>نشطة</option>
            <option value="0" ${!p.is_active ? 'selected' : ''}>معطلة</option>
          </select>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Attach live change listeners
    tbody.querySelectorAll(".prize-prob-input, .prize-active-select").forEach(el => {
      el.addEventListener("input", recalculateProbabilities);
    });

    recalculateProbabilities();
  }

  function recalculateProbabilities() {
    const probInputs = document.querySelectorAll(".prize-prob-input");
    const activeSelects = document.querySelectorAll(".prize-active-select");
    let total = 0;

    probInputs.forEach((input, idx) => {
      const val = parseFloat(input.value);
      const isActive = activeSelects[idx].value === "1";
      if (!isNaN(val) && val >= 0 && isActive) {
        total += val;
      }
    });

    const sumDisplay = document.getElementById("probSumDisplay");
    const meter = document.getElementById("probMeter");
    const saveBtn = document.getElementById("savePrizesBtn");

    sumDisplay.textContent = `${total.toFixed(2)}%`;

    if (Math.abs(total - 100) < 0.001) {
      meter.className = "prob-meter valid";
      meter.querySelector("span:first-child").textContent = "مجموع الاحتمالات صحيح: ";
      saveBtn.disabled = false;
    } else {
      meter.className = "prob-meter invalid";
      meter.querySelector("span:first-child").textContent = "مجموع الاحتمالات غير صحيح (يجب أن يساوي 100.00% بالضبط): ";
      saveBtn.disabled = true;
    }
  }

  document.getElementById("prizesForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rows = document.querySelectorAll("#prizesTableBody tr");
    const updated = [];

    rows.forEach(tr => {
      const id = tr.querySelector(".prize-label-input").dataset.id;
      const label = tr.querySelector(".prize-label-input").value.trim();
      const subtext = tr.querySelector(".prize-subtext-input").value.trim();
      const probability = parseFloat(tr.querySelector(".prize-prob-input").value);
      const is_active = parseInt(tr.querySelector(".prize-active-select").value, 10);

      updated.push({ id, label, subtext, probability, is_active });
    });

    try {
      const res = await fetchWithCsrf("/api/admin/prizes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prizes: updated })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "فشل حفظ الاحتمالات", "error");
        return;
      }
      showToast("تم تحديث نسب واحتمالات الجوائز بنجاح.");
      loadPrizes();
    } catch (err) {
      showToast("حدث خطأ في الاتصال", "error");
    }
  });

  // 4. Spin Records Loader
  async function loadSpins(page = 1) {
    const search = document.getElementById("spinsSearchInput").value.trim();
    try {
      const res = await fetchWithCsrf(`/api/admin/spins?page=${page}&limit=15&search=${encodeURIComponent(search)}`);
      const data = await res.json();
      if (!data.success) return;

      const tbody = document.getElementById("spinsTableBody");
      tbody.innerHTML = "";

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--admin-muted); padding: 24px;">لا توجد سجلات تدوير مطابقة.</td></tr>`;
      } else {
        data.data.forEach(s => {
          const tr = document.createElement("tr");
          const dateStr = new Date(s.created_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
          const redeemedStr = s.redeemed_at ? new Date(s.redeemed_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }) : '<span style="color: var(--admin-muted); font-size: 0.8rem;">---</span>';

          let actions = "";
          if (s.promo_code && s.promo_status === 'ACTIVE') {
            actions = `<button class="btn-action-sm redeem" onclick="window.redeemCode('${escapeHtml(s.promo_code)}', '${escapeHtml(s.participant_name || '')}')">استرداد الجائزة ✅</button>`;
          } else if (s.promo_code && s.promo_status === 'REDEEMED') {
            actions = `<button class="btn-action-sm" style="background: rgba(29, 111, 184, 0.15); color: #60A5FA; border-color: rgba(29, 111, 184, 0.3);" onclick="window.unredeemCode('${escapeHtml(s.promo_code)}')">إعادة كنشط 🔄</button>`;
          } else {
            actions = `<span style="color: var(--admin-muted); font-size: 0.8rem;">---</span>`;
          }

          const statusDisplay = s.promo_status === 'REDEEMED' ? 'مُسترد' : (s.promo_status === 'ACTIVE' ? 'نشط' : (s.promo_status || 'نشط'));

          tr.innerHTML = `
            <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(s.id.substring(0, 8))}...</td>
            <td><strong>${escapeHtml(s.participant_name || 'غير محدد')}</strong></td>
            <td><span dir="ltr" style="font-family: monospace; font-size: 0.85rem; color: #60A5FA;">${escapeHtml(s.participant_phone || '---')}</span></td>
            <td><strong>${escapeHtml(s.prize_label)}</strong></td>
            <td><strong style="color: #72F3AA; font-family: monospace;">${escapeHtml(s.promo_code || '---')}</strong></td>
            <td><span class="badge badge-${(s.promo_status || 'active').toLowerCase()}">${statusDisplay}</span></td>
            <td style="font-size: 0.84rem;">${dateStr}</td>
            <td style="font-size: 0.84rem;">${redeemedStr}</td>
            <td>${actions}</td>
          `;
          tbody.appendChild(tr);
        });
      }

      spinsPage = data.pagination.page;
      document.getElementById("spinsPageInfo").textContent = `صفحة ${data.pagination.page} من ${Math.max(1, data.pagination.pages)}`;
      document.getElementById("spinsPrevBtn").disabled = data.pagination.page <= 1;
      document.getElementById("spinsNextBtn").disabled = data.pagination.page >= data.pagination.pages;
    } catch (err) {
      console.error("Error loading spins:", err);
    }
  }

  document.getElementById("spinsSearchInput")?.addEventListener("input", () => loadSpins(1));
  document.getElementById("spinsPrevBtn")?.addEventListener("click", () => { if (spinsPage > 1) loadSpins(spinsPage - 1); });
  document.getElementById("spinsNextBtn")?.addEventListener("click", () => { loadSpins(spinsPage + 1); });

  // 5. Promo Codes Loader
  async function loadPromos(page = 1) {
    const search = document.getElementById("promosSearchInput").value.trim();
    const status = document.getElementById("promoStatusFilter").value;

    try {
      const res = await fetchWithCsrf(`/api/admin/promos?page=${page}&limit=15&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`);
      const data = await res.json();
      if (!data.success) return;

      const tbody = document.getElementById("promosTableBody");
      tbody.innerHTML = "";

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--admin-muted); padding: 24px;">لا توجد أكواد ترويجية مطابقة.</td></tr>`;
      } else {
        data.data.forEach(p => {
          const tr = document.createElement("tr");
          const createdStr = new Date(p.created_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
          const redeemedStr = p.redeemed_at ? new Date(p.redeemed_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }) : '<span style="color: var(--admin-muted); font-size: 0.8rem;">---</span>';

          const statusDisplay = p.status === 'REDEEMED' ? 'مُسترد' : (p.status === 'ACTIVE' ? 'نشط' : (p.status === 'CANCELLED' ? 'ملغي' : 'منتهي'));

          let actions = `
            <div class="promo-action-dropdown">
              <button type="button" class="btn-action-dots" aria-label="خيارات الكود" onclick="window.togglePromoDropdown(event, '${escapeHtml(p.code)}')">⋮</button>
              <div class="promo-dropdown-menu" id="dropdown-${escapeHtml(p.code)}">
                <button type="button" class="promo-dropdown-item" onclick="window.viewPromoDetails('${escapeHtml(p.code)}')">
                  👁️ عرض (View)
                </button>
                <button type="button" class="promo-dropdown-item" onclick="window.verifyAdminPromo('${escapeHtml(p.code)}')">
                  ⚡ تحقق (Verify)
                </button>
                ${p.status === 'ACTIVE' ? `
                  <button type="button" class="promo-dropdown-item danger" onclick="window.openCancelModal('${escapeHtml(p.code)}')">
                    🚫 شطب Promo Code
                  </button>
                ` : ''}
                ${p.status === 'ACTIVE' ? `
                  <button type="button" class="promo-dropdown-item" style="color: #34D399;" onclick="window.redeemCode('${escapeHtml(p.code)}', '${escapeHtml(p.participant_name || '')}')">
                    ✅ استرداد الجائزة
                  </button>
                ` : ''}
                ${p.status === 'REDEEMED' ? `
                  <button type="button" class="promo-dropdown-item" style="color: #60A5FA;" onclick="window.unredeemCode('${escapeHtml(p.code)}')">
                    🔄 إعادة كنشط
                  </button>
                ` : ''}
              </div>
            </div>
          `;

          tr.innerHTML = `
            <td><strong style="color: #72F3AA; font-family: monospace; font-size: 1.05rem;">${escapeHtml(p.code)}</strong></td>
            <td><strong>${escapeHtml(p.participant_name || 'غير محدد')}</strong></td>
            <td><span dir="ltr" style="font-family: monospace; font-size: 0.85rem; color: #60A5FA;">${escapeHtml(p.participant_phone || '---')}</span></td>
            <td><strong>${escapeHtml(p.prize_label)}</strong></td>
            <td style="font-size: 0.82rem;">${createdStr}</td>
            <td><span class="badge badge-${p.status.toLowerCase()}">${statusDisplay}</span></td>
            <td style="font-size: 0.82rem;">${redeemedStr}</td>
            <td>${actions}</td>
          `;
          tbody.appendChild(tr);
        });
      }

      promosPage = data.pagination.page;
      document.getElementById("promosPageInfo").textContent = `صفحة ${data.pagination.page} من ${Math.max(1, data.pagination.pages)}`;
      document.getElementById("promosPrevBtn").disabled = data.pagination.page <= 1;
      document.getElementById("promosNextBtn").disabled = data.pagination.page >= data.pagination.pages;
    } catch (err) {
      console.error("Error loading promos:", err);
    }
  }

  window.togglePromoDropdown = function(e, code) {
    e.stopPropagation();
    document.querySelectorAll('.promo-dropdown-menu.show').forEach(el => {
      if (el.id !== `dropdown-${code}`) el.classList.remove('show');
    });
    const menu = document.getElementById(`dropdown-${code}`);
    if (menu) menu.classList.toggle('show');
  };

  document.addEventListener('click', () => {
    document.querySelectorAll('.promo-dropdown-menu.show').forEach(el => el.classList.remove('show'));
  });

  window.viewPromoDetails = function(code) {
    if (window.doQuickLookup) {
      window.doQuickLookup(code);
      const overviewTab = document.querySelector('[data-tab="overview"]');
      if (overviewTab) overviewTab.click();
      const input = document.getElementById("quickLookupInput");
      if (input) input.value = code;
    }
  };

  let promoCodeToCancel = null;
  window.openCancelModal = function(code) {
    promoCodeToCancel = code;
    const modal = document.getElementById("cancelConfirmModal");
    const codeEl = document.getElementById("cancelModalCode");
    if (codeEl) codeEl.textContent = code;
    if (modal) modal.showModal();
  };

  document.getElementById("cancelModalDismissBtn")?.addEventListener("click", () => {
    const modal = document.getElementById("cancelConfirmModal");
    if (modal) modal.close();
    promoCodeToCancel = null;
  });

  document.getElementById("cancelModalConfirmBtn")?.addEventListener("click", async () => {
    if (!promoCodeToCancel) return;
    const code = promoCodeToCancel;
    const modal = document.getElementById("cancelConfirmModal");
    try {
      const res = await fetchWithCsrf(`/api/admin/promos/${code}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Admin cancellation via confirmation modal" })
      });
      const data = await res.json();
      if (modal) modal.close();
      promoCodeToCancel = null;

      if (!res.ok || !data.success) {
        showToast(data.error || "فشل شطب الكود الترويجي", "error");
        return;
      }

      showToast(`تم شطب الكود ${code} بنجاح! 🚫`, "error");
      loadPromos(promosPage);
      if (document.getElementById("spinsTableBody")) loadSpins(spinsPage);
      loadOverview();
      if (window.currentQuickLookupCode === code && window.doQuickLookup) {
        window.doQuickLookup(code);
      }
    } catch (err) {
      if (modal) modal.close();
      promoCodeToCancel = null;
      showToast("حدث خطأ أثناء الاتصال بالخادم", "error");
    }
  });

  window.cancelCode = window.openCancelModal;

  window.redeemCode = async function(code, participantName) {
    const confirmMsg = participantName
      ? `هل أنت متأكد من استرداد الجائزة للكود ${code} العائد للمشارك ${participantName}؟`
      : `هل أنت متأكد من استرداد الجائزة للكود ${code}؟`;
    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetchWithCsrf(`/api/admin/promos/${code}/redeem`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "فشل استرداد الجائزة", "error");
        return;
      }
      showToast(`تم استرداد الجائزة للكود ${code} بنجاح! ✅`);
      loadPromos(promosPage);
      if (document.getElementById("spinsTableBody")) loadSpins(spinsPage);
      loadOverview();
      if (window.currentQuickLookupCode === code && window.doQuickLookup) {
        window.doQuickLookup(code);
      }
    } catch (err) {
      showToast("حدث خطأ في الاتصال", "error");
    }
  };

  window.unredeemCode = async function(code) {
    if (!confirm(`هل تريد إلغاء حالة الاسترداد وإعادة تفعيل الكود ${code} كنشط؟`)) return;
    try {
      const res = await fetchWithCsrf(`/api/admin/promos/${code}/unredeem`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "فشل إعادة تفعيل الكود", "error");
        return;
      }
      showToast(`تمت إعادة الكود ${code} إلى الحالة النشطة بنجاح! 🔄`);
      loadPromos(promosPage);
      if (document.getElementById("spinsTableBody")) loadSpins(spinsPage);
      loadOverview();
      if (window.currentQuickLookupCode === code && window.doQuickLookup) {
        window.doQuickLookup(code);
      }
    } catch (err) {
      showToast("حدث خطأ في الاتصال", "error");
    }
  };

  document.getElementById("promosSearchInput")?.addEventListener("input", () => loadPromos(1));
  document.getElementById("promoStatusFilter")?.addEventListener("change", () => loadPromos(1));
  document.getElementById("promosPrevBtn")?.addEventListener("click", () => { if (promosPage > 1) loadPromos(promosPage - 1); });
  document.getElementById("promosNextBtn")?.addEventListener("click", () => { loadPromos(promosPage + 1); });

  // 6. Security Logs Loader
  async function loadSecurity() {
    try {
      const res = await fetchWithCsrf("/api/admin/security-logs");
      const data = await res.json();
      if (!data.success) return;

      const tbody = document.getElementById("securityTableBody");
      tbody.innerHTML = "";

      if (data.logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--admin-muted); padding: 24px;">سجل الأمان نظيف - لا توجد أحداث مشبوهة مسجلة.</td></tr>`;
      } else {
        data.logs.forEach(l => {
          const tr = document.createElement("tr");
          const dateStr = new Date(l.timestamp).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
          tr.innerHTML = `
            <td style="font-size: 0.82rem;">${dateStr}</td>
            <td><strong style="color: #F87171;">${l.event_type}</strong></td>
            <td style="font-family: monospace; font-size: 0.8rem;">${l.ip_hash || '---'}</td>
            <td style="font-family: monospace; font-size: 0.8rem;">${l.participant_id ? l.participant_id.substring(0, 8) + '...' : '---'}</td>
            <td style="font-size: 0.82rem; color: var(--admin-soft);">${l.details || ''}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    } catch (err) {
      console.error("Error loading security logs:", err);
    }
  }

  // 7. Audit Log Loader
  async function loadAudit() {
    try {
      const res = await fetchWithCsrf("/api/admin/audit-logs");
      const data = await res.json();
      if (!data.success) return;

      const tbody = document.getElementById("auditTableBody");
      tbody.innerHTML = "";

      if (data.logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--admin-muted); padding: 24px;">لا توجد عمليات إدارية مسجلة بعد.</td></tr>`;
      } else {
        data.logs.forEach(l => {
          const tr = document.createElement("tr");
          const dateStr = new Date(l.timestamp).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
          tr.innerHTML = `
            <td style="font-size: 0.82rem;">${dateStr}</td>
            <td><strong>${l.admin_user}</strong></td>
            <td><strong style="color: var(--admin-accent);">${l.action}</strong></td>
            <td style="font-size: 0.84rem;">${l.target || '---'}</td>
            <td><span class="badge ${l.result === 'SUCCESS' ? 'badge-active' : 'badge-cancelled'}">${l.result}</span></td>
            <td style="font-size: 0.82rem; color: var(--admin-muted);">${l.details || ''}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    } catch (err) {
      console.error("Error loading audit logs:", err);
    }
  }

  // 8. Change Password Form
  document.getElementById("changePasswordForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById("currentPasswordInput").value;
    const newPassword = document.getElementById("newPasswordInput").value;

    try {
      const res = await fetchWithCsrf("/api/admin/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "فشل تغيير كلمة المرور", "error");
        return;
      }
      showToast("تم تغيير كلمة المرور بنجاح.");
      document.getElementById("currentPasswordInput").value = "";
      document.getElementById("newPasswordInput").value = "";
    } catch (err) {
      showToast("حدث خطأ أثناء تغيير كلمة المرور", "error");
    }
  });

  // Logout Handler
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try {
      await fetchWithCsrf("/api/admin/logout", { method: "POST" });
    } catch (e) {}
    sessionStorage.removeItem("gowash_csrf_token");
    window.location.href = "/admin/login.html";
  });

  // Initialize
  checkAuth();
  initQuickLookup();
  initQuickRedeemTab();
});
