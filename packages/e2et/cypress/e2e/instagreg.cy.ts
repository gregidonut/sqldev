const postText = `post-${Date.now()}`;

describe("instagreg", () => {
  let skipRemaining = false;

  before(() => {
    cy.task("supabaseDbReset");
  });

  beforeEach(function () {
    if (skipRemaining) {
      throw new Error("An earlier test in this spec failed");
    }
    cy.viewport("iphone-6");
  });

  afterEach(function () {
    if (this.currentTest?.state === "failed") {
      skipRemaining = true;
    }
  });

  it("creates a post and shows it in the list", () => {
    cy.signInAsUser(0);

    cy.clerkLoaded();
    cy.window().should((win) => {
      expect(win.Clerk.user).to.not.equal(null);
    });

    cy.intercept("POST", "/api/views/igPosts/new/item").as("createPost");
    cy.intercept("GET", "/api/views/igPosts/list/get").as("listGet");

    cy.visit("/instagreg");
    cy.waitForClerkLoaded();
    cy.get("[data-cy='igPosts_list']", { timeout: 20000 }).should("exist");
    cy.wait("@listGet");

    cy.intercept("GET", "/api/views/igPosts/list/get").as("listRefetch");

    cy.get("[data-cy='p_text_content_field'] > input", {
      timeout: 20000,
    }).type(postText);
    cy.get("[data-cy='create_ig_post_submit']").click();

    cy.wait("@createPost").its("response.statusCode").should("eq", 200);
    cy.wait("@listRefetch");

    cy.get("[data-cy='igPosts_list']", { timeout: 20000 }).should(
      "contain",
      postText,
    );
  });

  it("edit post and update item", () => {
    cy.signInAsUser(0);

    cy.clerkLoaded();
    cy.window().should((win) => {
      expect(win.Clerk.user).to.not.equal(null);
    });

    cy.intercept("PATCH", "/api/views/igPosts/one/patch").as("updatePost");

    cy.visit("/instagreg");

    cy.contains("[data-cy='igPosts_list'] article", postText, {
      timeout: 20000,
    })
      .find("[data-cy='ig_post_actions']")
      .click();

    cy.get("[data-cy='ig_post_edit']").click();

    cy.get("[data-cy='edit_p_text_content_field'] textarea")
      .should("have.value", postText)
      .clear()
      .type(`## ${postText}`);

    cy.get("[data-cy='edit_ig_post_submit']").click();

    cy.wait("@updatePost").its("response.statusCode").should("eq", 200);

    cy.get("[data-cy='ig_post_body'] h2", { timeout: 20000 }).should(
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

  it("live-updates another user's list over MQTT", () => {
    const liveText = `live-${Date.now()}`;

    cy.signInAsUser(1);

    cy.clerkLoaded();
    cy.window().should((win) => {
      expect(win.Clerk.user).to.not.equal(null);
    });

    cy.intercept("GET", "/api/views/igPosts/list/get").as("listGet");

    cy.visit("/instagreg");
    cy.waitForClerkLoaded();
    cy.get("[data-cy='igPosts_list']", { timeout: 20000 }).should("exist");
    cy.wait("@listGet").its("response.statusCode").should("eq", 200);
    cy.get("[data-cy='mqtt_connected']", { timeout: 20000 }).should("exist");

    cy.env<{ test_users: [Cypress.TestUser, Cypress.TestUser] }>([
      "test_users",
    ]).then(({ test_users }) => {
      const actor = test_users[0];
      if (!actor) {
        throw new Error("test_users[0] is missing");
      }
      cy.task("createIgPostAsUser", {
        identifier: actor.user_id,
        p_text_content: liveText,
        p_public: true,
      })
        .its("post_id")
        .should("be.a", "string");
    });

    cy.get("[data-cy='igPosts_list']", { timeout: 20000 }).should(
      "contain",
      liveText,
    );
    cy.location("pathname").should("include", "instagreg");
  });
});
