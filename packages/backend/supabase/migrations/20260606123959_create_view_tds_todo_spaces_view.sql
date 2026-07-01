CREATE VIEW tds_todo_spaces_view AS
SELECT ts.todo_space_id, ts.created_at, latest.created_at AS updated_at, latest.name
FROM tds_todo_spaces AS ts
         INNER JOIN LATERAL (SELECT tsd.created_at, tsd.name
                             FROM tds_todo_space_data AS tsd
                             WHERE ts.todo_space_id = tsd.todo_space_id
                             ORDER BY tsd.created_at DESC
                             LIMIT 1) AS latest ON TRUE
ORDER BY ts.created_at DESC;

