/**
 * Smoke test — guarantees Cypress always has at least one spec to run.
 *
 * The real specs under cypress/e2e/company-admin/ are excluded in
 * cypress.config.ts until CI is wired to run Firebase emulators + seed
 * test users. Without this file Cypress exits with
 * "Can't run because no spec files were found" which the github-action
 * surfaces as a job failure.
 */

describe('Smoke', () => {
  it('loads the root page', () => {
    cy.visit('/');
    cy.get('body').should('exist');
  });
});
