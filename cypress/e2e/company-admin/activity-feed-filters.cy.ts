/**
 * TEST CASE #12: Activity Feed Filters
 *
 * Проверяет, что фильтры activity feed работают корректно
 */

describe('Activity Feed Filters', () => {
  beforeEach(() => {
    cy.login('admin@company-a.test', 'TestPassword123');
    cy.visit('/admin/dashboard');

    // Wait for activity feed to load
    cy.get('[data-testid="activity-feed"]').should('be.visible');
  });

  it('should filter by action type', () => {
    // 1. Initial state: all activities visible
    cy.get('[data-testid="activity-item"]')
      .should('have.length.greaterThan', 5);

    // 2. Open filter dropdown
    cy.get('[data-testid="activity-filter"]').click();

    // 3. Select "role_changed" filter
    cy.contains('Role Changed').click();

    // 4. Verify only role_changed activities are shown
    cy.get('[data-testid="activity-item"]').each(($item) => {
      cy.wrap($item).should('contain', 'Role changed');
    });

    // Verify the count
    cy.get('[data-testid="activity-item"]')
      .should('have.length.lessThan', 6);

    // 5. Clear filter
    cy.get('[data-testid="clear-filter"]').click();

    // 6. Verify all activities are back
    cy.get('[data-testid="activity-item"]')
      .should('have.length.greaterThan', 5);
  });

  it('should filter by date range', () => {
    // Select "Last 7 days"
    cy.get('[data-testid="date-range-filter"]').select('7days');

    // Verify all visible activities are within 7 days
    cy.get('[data-testid="activity-timestamp"]').each(($timestamp) => {
      const activityDateStr = $timestamp.text();
      const activityDate = new Date(activityDateStr);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      expect(activityDate.getTime()).to.be.greaterThan(sevenDaysAgo.getTime());
    });
  });

  it('should filter by user', () => {
    // Open user filter
    cy.get('[data-testid="user-filter"]').click();

    // Select specific user
    cy.contains('John Doe').click();

    // Verify only activities from John Doe are shown
    cy.get('[data-testid="activity-item"]').each(($item) => {
      cy.wrap($item).should('contain', 'John Doe');
    });
  });

  it('should combine multiple filters', () => {
    // Apply action type filter
    cy.get('[data-testid="activity-filter"]').click();
    cy.contains('Login').click();

    // Apply date range filter
    cy.get('[data-testid="date-range-filter"]').select('24hours');

    // Verify activities match both filters
    cy.get('[data-testid="activity-item"]').each(($item) => {
      cy.wrap($item).should('contain', 'logged in');
    });

    // Check date is within 24 hours
    cy.get('[data-testid="activity-timestamp"]').first().then(($el) => {
      const dateStr = $el.text();
      const activityDate = new Date(dateStr);
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      expect(activityDate.getTime()).to.be.greaterThan(twentyFourHoursAgo.getTime());
    });
  });

  it('should show empty state when no activities match filter', () => {
    // Apply a filter that should have no results
    cy.get('[data-testid="activity-filter"]').click();
    cy.contains('Role Changed').click();

    cy.get('[data-testid="date-range-filter"]').select('24hours');

    // Verify empty state is shown
    cy.contains('No activities found').should('be.visible');

    // Clear filters
    cy.get('[data-testid="clear-all-filters"]').click();

    // Activities should be visible again
    cy.get('[data-testid="activity-item"]')
      .should('have.length.greaterThan', 0);
  });

  it('should persist filters on page reload', () => {
    // Apply filters
    cy.get('[data-testid="activity-filter"]').click();
    cy.contains('Login').click();

    cy.get('[data-testid="date-range-filter"]').select('7days');

    // Reload page
    cy.reload();

    // Verify filters are still applied
    cy.get('[data-testid="activity-filter"]')
      .should('contain', 'Login');

    cy.get('[data-testid="date-range-filter"]')
      .should('have.value', '7days');
  });

  it('should update URL with filter parameters', () => {
    // Apply filters
    cy.get('[data-testid="activity-filter"]').click();
    cy.contains('Login').click();

    // Verify URL contains filter params
    cy.url().should('include', 'action=login');

    // Apply date filter
    cy.get('[data-testid="date-range-filter"]').select('7days');

    cy.url().should('include', 'range=7days');
  });
});
