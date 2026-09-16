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
      loadCurrentTab();
    });
  });

  function loadCurrentTab() {
    switch (currentTab) {
      case "overview": loadOverview(); break;
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
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--admin-muted); padding: 24px;">لا توجد سجلات تدوير مطابقة.</td></tr>`;
      } else {
        data.data.forEach(s => {
          const tr = document.createElement("tr");
          const dateStr = new Date(s.created_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
          tr.innerHTML = `
            <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(s.id.substring(0, 8))}...</td>
            <td><strong>${escapeHtml(s.participant_name || 'غير محدد')}</strong></td>
            <td><span dir="ltr" style="font-family: monospace; font-size: 0.85rem; color: #60A5FA;">${escapeHtml(s.participant_phone || '---')}</span></td>
            <td><strong>${escapeHtml(s.prize_label)}</strong></td>
            <td><strong style="color: #72F3AA; font-family: monospace;">${escapeHtml(s.promo_code || '---')}</strong></td>
            <td><span class="badge badge-${(s.promo_status || 'active').toLowerCase()}">${escapeHtml(s.promo_status || 'ACTIVE')}</span></td>
            <td style="font-size: 0.84rem;">${dateStr}</td>
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
          const redeemedStr = p.redeemed_at ? new Date(p.redeemed_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }) : '---';

          let actions = "";
          if (p.status === 'ACTIVE') {
            actions = `
              <button class="btn-action-sm redeem" onclick="window.redeemCode('${p.code}')">صرف الكود</button>
              <button class="btn-action-sm cancel" onclick="window.cancelCode('${p.code}')">إلغاء</button>
            `;
          } else {
            actions = `<span style="color: var(--admin-muted); font-size: 0.8rem;">لا توجد إجراءات</span>`;
          }

          tr.innerHTML = `
            <td><strong style="color: #72F3AA; font-family: monospace; font-size: 1.05rem;">${escapeHtml(p.code)}</strong></td>
            <td><strong>${escapeHtml(p.participant_name || 'غير محدد')}</strong></td>
            <td><span dir="ltr" style="font-family: monospace; font-size: 0.85rem; color: #60A5FA;">${escapeHtml(p.participant_phone || '---')}</span></td>
            <td><strong>${escapeHtml(p.prize_label)}</strong></td>
            <td style="font-size: 0.82rem;">${createdStr}</td>
            <td><span class="badge badge-${p.status.toLowerCase()}">${escapeHtml(p.status)}</span></td>
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

  window.redeemCode = async function(code) {
    if (!confirm(`هل تريد تأكيد صرف واستخدام الكود ${code} للعميل؟`)) return;
    try {
      const res = await fetchWithCsrf(`/api/admin/promos/${code}/redeem`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "فشل صرف الكود", "error");
        return;
      }
      showToast(`تم صرف الكود ${code} بنجاح!`);
      loadPromos(promosPage);
      loadOverview();
    } catch (err) {
      showToast("حدث خطأ في الاتصال", "error");
    }
  };

  window.cancelCode = async function(code) {
    if (!confirm(`هل تريد بالتأكيد إلغاء الكود ${code}؟ لن يتمكن العميل من استخدامه.`)) return;
    try {
      const res = await fetchWithCsrf(`/api/admin/promos/${code}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "فشل إلغاء الكود", "error");
        return;
      }
      showToast(`تم إلغاء الكود ${code}.`);
      loadPromos(promosPage);
      loadOverview();
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
});
