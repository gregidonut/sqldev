import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTodoSpaceViaApi,
  createTodoViaApi,
  seedsThroughGoApi,
} from "./apiSeed.js";
import { firstStringField, withUserSupabase } from "./actorSupabase.js";

export interface CreateTdsTodoSpaceAsUserArgs {
  identifier: string;
  p_name: string;
  p_public?: boolean;
}

export interface CreateTdsTodoSpaceAsUserResult {
  todo_space_id: string;
}

export interface SeedTdsTodo {
  p_title: string;
  p_description: string;
}

export interface CreateTdsTodosAsUserArgs {
  identifier: string;
  p_name: string;
  p_public?: boolean;
  todos: SeedTdsTodo[];
}

export interface CreateTdsTodosAsUserResult {
  todo_space_id: string;
  todo_ids: string[];
}

export async function createTdsTodoSpaceAsUser({
  identifier,
  p_name,
  p_public = false,
}: CreateTdsTodoSpaceAsUserArgs): Promise<CreateTdsTodoSpaceAsUserResult> {
  if (seedsThroughGoApi()) {
    const todo_space_id = await createTodoSpaceViaApi(identifier, p_name, p_public);
    return { todo_space_id };
  }
  return withUserSupabase(identifier, async (supabase) => {
    const todo_space_id = await insertTodoSpace(supabase, p_name, p_public);
    return { todo_space_id };
  });
}

export async function createTdsTodosAsUser({
  identifier,
  p_name,
  p_public = false,
  todos,
}: CreateTdsTodosAsUserArgs): Promise<CreateTdsTodosAsUserResult> {
  if (seedsThroughGoApi()) {
    const todo_space_id = await createTodoSpaceViaApi(identifier, p_name, p_public);
    const todo_ids: string[] = [];
    // Awaited one at a time: the job queue does not guarantee ordering across
    // concurrently submitted jobs, and specs may depend on creation order.
    for (const todo of todos) {
      todo_ids.push(
        await createTodoViaApi(
          identifier,
          todo_space_id,
          todo.p_title,
          todo.p_description,
        ),
      );
    }
    return { todo_space_id, todo_ids };
  }
  return withUserSupabase(identifier, async (supabase) => {
    const todo_space_id = await insertTodoSpace(supabase, p_name, p_public);
    const todo_ids: string[] = [];

    for (const todo of todos) {
      const { data, error } = await supabase.rpc("create_tds_todo", {
        p_todo_space_id: todo_space_id,
        p_title: todo.p_title,
        p_description: todo.p_description,
      });
      if (error) {
        throw new Error(`create_tds_todo failed: ${error.message}`);
      }
      const todo_id = firstStringField(data, "todo_id");
      if (!todo_id) {
        throw new Error("create_tds_todo returned no todo_id");
      }
      todo_ids.push(todo_id);
    }

    return { todo_space_id, todo_ids };
  });
}

async function insertTodoSpace(
  supabase: SupabaseClient,
  p_name: string,
  p_public: boolean,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_tds_todo_space", {
    p_name,
    p_public,
  });
  if (error) {
    throw new Error(`create_tds_todo_space failed: ${error.message}`);
  }
  const todo_space_id = firstStringField(data, "todo_space_id");
  if (!todo_space_id) {
    throw new Error("create_tds_todo_space returned no todo_space_id");
  }
  return todo_space_id;
}
