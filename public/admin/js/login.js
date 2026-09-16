document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm");
  const errorBox = document.getElementById("errorBox");
  const submitBtn = document.getElementById("submitBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "جاري تسجيل الدخول...";

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        errorBox.textContent = data.error || "فشل تسجيل الدخول. يرجى التحقق من البيانات.";
        errorBox.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = "تسجيل الدخول";
        return;
      }

      // Store CSRF token in sessionStorage for admin API requests
      if (data.csrfToken) {
        sessionStorage.setItem("gowash_csrf_token", data.csrfToken);
      }

      // Redirect to main admin dashboard
      window.location.href = "/admin";
    } catch (err) {
      console.error("Login error:", err);
      errorBox.textContent = "فشل الاتصال بالخادم. يرجى المحاولة مرة أخرى.";
      errorBox.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "تسجيل الدخول";
    }
  });
});
