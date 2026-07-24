CREATE VIEW tds_todos_view AS
SELECT td.todo_space_id
     , td.todo_item_id
     , td.created_at
     , latest.created_at AS updated_at
     , latest.todo_item_parent_id
     , latest.title
     , latest.description
FROM tds_todo_items AS td
         INNER JOIN LATERAL (
    SELECT tdc.created_at, tdc.title, tdc.description, tdc.todo_item_parent_id
    FROM tds_todo_item_data AS tdc
    WHERE td.todo_item_id = tdc.todo_item_id
    ORDER BY tdc.created_at DESC
    LIMIT 1
    ) AS latest ON TRUE
ORDER BY td.created_at DESC;


