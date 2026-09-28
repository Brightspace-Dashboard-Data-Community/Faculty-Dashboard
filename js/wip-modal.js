/**
 * Work-in-Progress Modal
 * Displays a modal on page load to inform users that the site is under development
 */

(function() {
  'use strict';

  // Check if modal has been shown before (using sessionStorage)
  const MODAL_SHOWN_KEY = 'wip-modal-shown';
  
  /**
   * Initialize the modal
   */
  function initModal() {
    const modal = document.getElementById('wip-modal');
    const closeButton = document.getElementById('wip-modal-close');
    const overlay = modal.querySelector('.wip-modal-overlay');
    
    if (!modal || !closeButton) {
      console.warn('[WIP Modal] Modal elements not found');
      return;
    }

    // Check if modal has already been shown in this session
    const hasBeenShown = sessionStorage.getItem(MODAL_SHOWN_KEY);
    
    if (!hasBeenShown) {
      // Show modal after a brief delay for better UX
      setTimeout(() => {
        modal.style.display = 'flex';
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden';
        // Focus on close button for accessibility
        closeButton.focus();
      }, 300);
    }

    // Close button click handler
    closeButton.addEventListener('click', closeModal);
    
    // Overlay click handler (close on backdrop click)
    overlay.addEventListener('click', closeModal);
    
    // Escape key handler
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        closeModal();
      }
    });
  }

  /**
   * Close the modal
   */
  function closeModal() {
    const modal = document.getElementById('wip-modal');
    if (!modal) return;
    
    modal.style.display = 'none';
    // Restore body scroll
    document.body.style.overflow = '';
    // Mark as shown in this session
    sessionStorage.setItem(MODAL_SHOWN_KEY, 'true');
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModal);
  } else {
    initModal();
  }
})();
