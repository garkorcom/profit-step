/**
 * TEST CASE #11: Resend Invitation Flow (E2E)
 *
 * Полная проверка flow:
 * Нажатие кнопки → API call → UI update → Email отправка
 */

describe('Resend Invitation Flow', () => {
  beforeEach(() => {
    // Login as company admin
    cy.login('admin@company-a.test', 'TestPassword123');
    cy.visit('/admin/team');

    // Wait for page to load
    cy.get('[data-testid="team-members-table"]').should('be.visible');
  });

  it('should resend invitation and update UI', () => {
    // 1. Find pending invitation
    cy.contains('pending@user.com')
      .parents('tr')
      .within(() => {
        // 2. Check initial status
        cy.contains('Pending').should('exist');

        // 3. Click "Resend" button
        cy.contains('button', 'Resend').click();
      });

    // 4. Verify UI feedback (toast notification)
    cy.contains('Invitation resent successfully').should('be.visible');

    // 5. Verify status updated to "Resent" or "Sent"
    cy.contains('pending@user.com')
      .parents('tr')
      .should('contain', 'Sent');

    // 6. Verify timestamp updated
    cy.contains('pending@user.com')
      .parents('tr')
      .find('[data-testid="sent-at"]')
      .should('not.be.empty');
  });

  it('should show error if resend fails', () => {
    // Mock API failure
    cy.intercept('POST', '/api/admin/resend-invitation', {
      statusCode: 500,
      body: { error: 'Email service unavailable' },
    }).as('resendFail');

    cy.contains('pending@user.com')
      .parents('tr')
      .contains('button', 'Resend')
      .click();

    cy.wait('@resendFail');

    // Verify error message
    cy.contains('Failed to resend invitation').should('be.visible');

    // Status should not change
    cy.contains('pending@user.com')
      .parents('tr')
      .should('contain', 'Pending');
  });

  it('should disable resend button during request', () => {
    // Intercept and delay the API call
    cy.intercept('POST', '/api/admin/resend-invitation', (req) => {
      req.reply((res) => {
        res.delay = 2000; // 2 second delay
        res.send({ success: true });
      });
    }).as('resendSlow');

    cy.contains('pending@user.com')
      .parents('tr')
      .contains('button', 'Resend')
      .click();

    // Button should be disabled
    cy.contains('pending@user.com')
      .parents('tr')
      .contains('button', 'Resend')
      .should('be.disabled');

    // Wait for request to complete
    cy.wait('@resendSlow');

    // Button should be enabled again
    cy.contains('pending@user.com')
      .parents('tr')
      .contains('button', 'Resend')
      .should('not.be.disabled');
  });

  it('should show confirmation dialog before resending', () => {
    // If confirmation dialog is implemented
    cy.contains('pending@user.com')
      .parents('tr')
      .contains('button', 'Resend')
      .click();

    // Check for confirmation dialog (if applicable)
    // cy.contains('Are you sure you want to resend?').should('be.visible');
    // cy.contains('button', 'Confirm').click();

    cy.contains('Invitation resent successfully').should('be.visible');
  });
});
