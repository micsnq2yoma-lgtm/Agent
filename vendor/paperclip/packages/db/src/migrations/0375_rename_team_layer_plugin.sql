-- AgenTeam rename (was Agentself): the team-layer plugin keeps its row, and with it every plugin_state /
-- plugin_entities / plugin job row keyed by the plugin's uuid, under its new key. Skipped when the new key exists.
UPDATE "plugins"
SET "plugin_key" = 'agenteam.team-layer',
    "package_name" = replace("package_name", '@agentself/', '@agenteam/'),
    "manifest_json" = jsonb_set("manifest_json", '{id}', '"agenteam.team-layer"'),
    "updated_at" = now()
WHERE "plugin_key" = 'agentself.team-layer'
  AND NOT EXISTS (SELECT 1 FROM "plugins" WHERE "plugin_key" = 'agenteam.team-layer');
