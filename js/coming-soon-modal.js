/**
 * D2L Faculty Dashboard - Coming Soon Modal
 * Displays a "coming soon" message that blocks page content for non-admin users
 * Allows your.brightspace.username and another.brightspace.username to bypass the modal
 * Local dev hosts (localhost, 127.0.0.1, etc.) bypass the modal for testing without D2L whoami
 */

(function() {
  'use strict';

  var API_VERSION_LP = "1.51";
  
  // Allowed users who can bypass the coming soon modal
  const ALLOWED_USERNAMES = ['your.brightspace.username', 'another.brightspace.username'];

  function isLocalDevHost() {
    var h = (window.location.hostname || '').toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') {
      return true;
    }
    if (window.location.protocol === 'file:') {
      return true;
    }
    return false;
  }

  // ============================================
  // D2L API Functions
  // ============================================
  async function BrightspaceFetch(url, options) {
    var token = localStorage.getItem("XSRF.Token");
    var opts = options || {};
    if (!opts.headers) opts.headers = {};
    opts.headers["X-CSRF-Token"] = token;
    opts.credentials = "include";

    var res = await fetch(url, opts);
    if (!res.ok) {
      var error = new Error("HTTP " + res.status + " - " + url);
      error.status = res.status;
      error.url = url;
      error.isExpected = (res.status === 403 || res.status === 404);
      throw error;
    }
    return await res.json();
  }

  async function getUserInfo() {
    try {
      var data = await BrightspaceFetch("/d2l/api/lp/" + API_VERSION_LP + "/users/whoami");
      return {
        userId: data.Identifier || data.UserId || null,
        firstName: data.FirstName || "",
        lastName: data.LastName || "",
        userName: data.UniqueName || "",
        email: data.ExternalEmail || "",
        profileImageUrl: data.ProfileImageUrl || null
      };
    } catch (e) {
      console.warn("Failed to fetch user info:", e);
      return { userId: null, firstName: "Instructor", lastName: "", userName: "", email: "", profileImageUrl: null };
    }
  }

  // ============================================
  // Check if user is allowed
  // ============================================
  async function isUserAllowed() {
    if (isLocalDevHost()) {
      console.log('Coming soon bypass: local development (no viewer restriction)');
      return true;
    }
    try {
      const userInfo = await getUserInfo();
      const currentUsername = (userInfo.userName || userInfo.userId || '').toLowerCase();
      
      const isAllowed = ALLOWED_USERNAMES.some(allowedName => 
        currentUsername === allowedName.toLowerCase()
      );
      
      if (isAllowed) {
        console.log('User allowed to view page:', userInfo.userName || userInfo.userId);
        return true;
      }
      
      console.log('User not allowed to view page:', userInfo.userName || userInfo.userId || 'unknown user');
      return false;
    } catch (e) {
      console.error("Error checking user access:", e);
      // On error, show the modal to be safe
      return false;
    }
  }

  // ============================================
  // Create Coming Soon Modal
  // ============================================
  function createComingSoonModal(pageName) {
    // Create modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'coming-soon-overlay';
    modalOverlay.className = 'coming-soon-overlay';
    modalOverlay.setAttribute('role', 'dialog');
    modalOverlay.setAttribute('aria-labelledby', 'coming-soon-title');
    modalOverlay.setAttribute('aria-modal', 'true');

    // Create modal content
    modalOverlay.innerHTML = `
      <div class="coming-soon-modal">
        <div class="coming-soon-header">
          <div class="coming-soon-icon">
            <i class="fas fa-clock" aria-hidden="true"></i>
          </div>
          <h2 id="coming-soon-title" class="coming-soon-title">Coming Soon</h2>
        </div>
        <div class="coming-soon-body">
          <p class="coming-soon-message">The ${pageName} page is currently under development and will be available soon.</p>
          <p class="coming-soon-submessage">Please return to the Home page to access other features.</p>
        </div>
        <div class="coming-soon-footer">
          <a href="index.html" class="coming-soon-button">
            <i class="fas fa-home" aria-hidden="true"></i>
            Go Back to Home
          </a>
        </div>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .coming-soon-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        padding: 20px;
      }

      .coming-soon-modal {
        background: #ffffff;
        border-radius: 16px;
        max-width: 500px;
        width: 100%;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        animation: modalFadeIn 0.3s ease-out;
      }

      @keyframes modalFadeIn {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .coming-soon-header {
        padding: 32px 32px 24px;
        text-align: center;
        border-bottom: 1px solid #e5e7eb;
      }

      .coming-soon-icon {
        width: 80px;
        height: 80px;
        margin: 0 auto 20px;
        background: linear-gradient(135deg, #0f5b46 0%, #059669 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 36px;
      }

      .coming-soon-title {
        font-size: 28px;
        font-weight: 900;
        color: #0f5b46;
        margin: 0;
      }

      .coming-soon-body {
        padding: 32px;
        text-align: center;
      }

      .coming-soon-message {
        font-size: 18px;
        color: #374151;
        margin: 0 0 12px;
        line-height: 1.6;
      }

      .coming-soon-submessage {
        font-size: 16px;
        color: #6b7280;
        margin: 0;
        line-height: 1.6;
      }

      .coming-soon-footer {
        padding: 24px 32px 32px;
        text-align: center;
        border-top: 1px solid #e5e7eb;
      }

      .coming-soon-button {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 14px 28px;
        background: #0f5b46;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
        transition: all 0.2s;
      }

      .coming-soon-button:hover {
        background: #059669;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(15, 91, 70, 0.3);
      }

      .coming-soon-button:active {
        transform: translateY(0);
      }

      .coming-soon-button i {
        font-size: 18px;
      }

      /* Blur effect for page content */
      .page-blurred {
        filter: blur(5px);
        pointer-events: none;
        user-select: none;
        overflow: hidden;
        position: relative;
      }

      .page-blurred * {
        pointer-events: none;
      }

      body.coming-soon-active {
        overflow: hidden;
        height: 100vh;
      }

      /* Responsive */
      @media (max-width: 640px) {
        .coming-soon-modal {
          margin: 20px;
        }

        .coming-soon-header,
        .coming-soon-body,
        .coming-soon-footer {
          padding: 24px;
        }

        .coming-soon-title {
          font-size: 24px;
        }

        .coming-soon-message {
          font-size: 16px;
        }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modalOverlay);

    // Prevent closing the modal by clicking outside or pressing ESC
    modalOverlay.addEventListener('click', function(e) {
      if (e.target === modalOverlay) {
        // Do nothing - prevent closing
        e.preventDefault();
        e.stopPropagation();
      }
    });

    // Prevent ESC key from closing
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && document.getElementById('coming-soon-overlay')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true });

    // Blur the page content
    const mainContent = document.querySelector('main') || document.body;
    mainContent.classList.add('page-blurred');
    
    // Also blur the navigation if it exists
    const nav = document.querySelector('nav') || document.querySelector('#nav-placeholder');
    if (nav) {
      nav.classList.add('page-blurred');
    }

    // Prevent body scrolling when modal is open
    document.body.classList.add('coming-soon-active');
  }

  // ============================================
  // Initialize Coming Soon Modal
  // ============================================
  async function initComingSoonModal(pageName) {
    try {
      const allowed = await isUserAllowed();
      
      if (!allowed) {
        // User is not allowed, show the modal
        createComingSoonModal(pageName);
      } else {
        // User is allowed, do nothing - page loads normally
        console.log('User has access to view the page');
      }
    } catch (e) {
      console.error("Error initializing coming soon modal:", e);
      if (isLocalDevHost()) {
        return;
      }
      createComingSoonModal(pageName);
    }
  }

  // ============================================
  // Export function for use in other scripts
  // ============================================
  window.initComingSoonModal = initComingSoonModal;

  // Auto-initialize if page has data attribute
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      const pageName = document.body.getAttribute('data-coming-soon-page');
      if (pageName) {
        initComingSoonModal(pageName);
      }
    });
  } else {
    const pageName = document.body.getAttribute('data-coming-soon-page');
    if (pageName) {
      initComingSoonModal(pageName);
    }
  }

})();
