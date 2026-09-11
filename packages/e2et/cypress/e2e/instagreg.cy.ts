describe("template spec", () => {
  beforeEach(() => {
    cy.signInAsUser(0);
    cy.viewport("iphone-6");
  });

  it("passes", () => {
    cy.clerkLoaded();
    cy.window().should((win) => {
      expect(win.Clerk.user).to.not.equal(null);
    });

    cy.visit("/instagreg");
  });
});
