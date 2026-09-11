const postText = `post-${Date.now()}`;

describe("instagreg", () => {
  before(() => {
    cy.task("supabaseDbReset");
  });

  beforeEach(() => {
    cy.viewport("iphone-6");
  });

  it("creates a post and shows it in the list", () => {
    cy.signInAsUser(0);

    cy.clerkLoaded();
    cy.window().should((win) => {
      expect(win.Clerk.user).to.not.equal(null);
    });

    cy.intercept("POST", "/api/views/igPosts/new/item").as("createPost");

    cy.visit("/instagreg");

    cy.get("[data-cy='p_text_content_field'] > input").type(postText);
    cy.get("[data-cy='create_ig_post_submit']").click();

    cy.wait("@createPost").its("response.statusCode").should("eq", 200);

    cy.get("[data-cy='igPosts_list']", { timeout: 20000 }).should(
      "contain",
      postText,
    );
  });

  it("another user can see public post", () => {
    cy.signInAsUser(1);

    cy.clerkLoaded();
    cy.window().should((win) => {
      expect(win.Clerk.user).to.not.equal(null);
    });

    cy.visit("/instagreg");

    cy.get("[data-cy='igPosts_list']", { timeout: 20000 }).should(
      "contain",
      postText,
    );
  });
});
