// =========================================================
// Auth Gate (Google Sign-In) - Admin Panel
// - Keeps the dashboard locked until Google sign-in succeeds.
// - Optional allowlist by email(s).
// =========================================================

import {
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    signOut
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

function normEmail(v) {
    return String(v || "").trim().toLowerCase();
}

function mapAuthError(err) {
    const code = err?.code || "";
    switch (code) {
        case "auth/popup-closed-by-user":
            return "تم إغلاق نافذة تسجيل الدخول قبل إكمال العملية.";
        case "auth/cancelled-popup-request":
            return "تم إلغاء طلب تسجيل الدخول.";
        case "auth/popup-blocked":
            return "المتصفح منع نافذة تسجيل الدخول. سيتم التحويل لتسجيل الدخول عبر صفحة Google.";
        case "auth/operation-not-allowed":
            return "مزود تسجيل الدخول عبر Google غير مُفعّل في Firebase (Authentication).";
        case "auth/unauthorized-domain":
            return "هذا الدومين غير مُصرّح به في إعدادات Firebase Authentication.";
        default:
            return "تعذر تسجيل الدخول. يرجى المحاولة مرة أخرى.";
    }
}

/**
 * Initializes the Google auth gate.
 * @param {{auth: any, allowedEmails?: string[]}} opts
 * @returns {Promise<any>} Resolves with the Firebase user when authenticated & allowed.
 */
export async function initAdminAuthGate(opts) {
    const auth = opts?.auth;
    const allowedEmails = Array.isArray(opts?.allowedEmails) ? opts.allowedEmails.map(normEmail).filter(Boolean) : [];

    // Lock UI immediately (in case index.html forgot data-auth="pending")
    try { document.body.dataset.auth = "pending"; } catch {}

    const overlay = document.getElementById("auth-overlay");
    const btn = document.getElementById("btn-google-login");
    const errBox = document.getElementById("auth-error");

    const showError = (msg) => {
        if (!errBox) return;
        errBox.textContent = msg || "";
        errBox.classList.remove("hidden");
    };

    const clearError = () => {
        if (!errBox) return;
        errBox.textContent = "";
        errBox.classList.add("hidden");
    };

    const setLoading = (isLoading) => {
        if (!btn) return;
        btn.disabled = !!isLoading;
        btn.classList.toggle("loading", !!isLoading);
    };

    // Expose logout helper (optional hook for the existing "خروج" button)
    window.adminLogout = async () => {
        try { await signOut(auth); } catch {}
        location.reload();
    };

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    // If we returned from redirect, consume the result to surface errors (if any)
    try {
        await getRedirectResult(auth);
    } catch (e) {
        // Don't block; just show a useful error
        showError(mapAuthError(e));
    }

    const startSignIn = async () => {
        clearError();
        setLoading(true);

        // Prefer popup, but fall back to redirect when blocked/unavailable.
        try {
            await signInWithPopup(auth, provider);
        } catch (e) {
            if (e?.code === "auth/popup-blocked" || e?.code === "auth/popup-closed-by-user") {
                // Redirect flow will navigate away
                await signInWithRedirect(auth, provider);
                return;
            }
            // Some environments (e.g., PWA) may not like popups.
            try {
                await signInWithRedirect(auth, provider);
                return;
            } catch (e2) {
                throw e2;
            }
        } finally {
            setLoading(false);
        }
    };

    if (btn) {
        btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            try {
                await startSignIn();
            } catch (e) {
                showError(mapAuthError(e));
            }
        });
    }

    // If elements are missing, fail open (but log) to avoid breaking the app unexpectedly.
    if (!overlay || !btn) {
        console.warn("[AuthGate] Missing #auth-overlay or #btn-google-login. App will continue without gate.");
        document.body.dataset.auth = "ready";
        return null;
    }

    return new Promise((resolve) => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                // Still locked; keep overlay visible.
                try { document.body.dataset.auth = "pending"; } catch {}
                return;
            }

            // Optional allowlist by email
            if (allowedEmails.length > 0) {
                const email = normEmail(user.email);
                const ok = allowedEmails.includes(email);
                if (!ok) {
                    try { await signOut(auth); } catch {}
                    showError(`هذا الحساب غير مخوّل. الحساب المسموح: ${allowedEmails[0]}`);
                    try { document.body.dataset.auth = "pending"; } catch {}
                    return;
                }
            }

            clearError();
            try { document.body.dataset.auth = "ready"; } catch {}
            unsub();
            resolve(user);
        });
    });
}
