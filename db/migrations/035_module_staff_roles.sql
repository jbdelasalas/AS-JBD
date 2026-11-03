-- 035_module_staff_roles.sql
-- Roles for warehouse personnel and dressing-plant personnel.
--
-- Each role holds one module-access permission. A user whose permissions are
-- only these (optionally plus label printing) is confined to those modules:
-- middleware rejects other API calls, the sidebar shows only the module and the
-- dashboard redirects anywhere else (see apps/web/src/lib/access-scopes.ts).
-- Give someone both roles to let them work in both modules.
--
-- Run against both schemas the app serves (public and sandbox).

INSERT INTO permissions (code, module, action, name) VALUES
  ('wms.access',            'wms',            'manage', 'Work in the warehouse module'),
  ('dressing_plant.access', 'dressing_plant', 'manage', 'Work in the dressing plant module')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name, description) VALUES
  ('warehouse_staff', 'Warehouse staff',
   'Bins, put-away, picking, shipments, scanning. No access to any other module.'),
  ('dressing_plant_staff', 'Dressing plant staff',
   'Job orders, receiving, production, cold chain, labels, dispatch. No access to any other module.')
ON CONFLICT (code) DO NOTHING;

-- Exact grants, so a re-run restores the intended boundary.
DELETE FROM role_permissions rp
 USING roles r
 WHERE rp.role_id = r.id
   AND ((r.code = 'warehouse_staff' AND rp.permission_id NOT IN (SELECT id FROM permissions WHERE code = 'wms.access'))
     OR (r.code = 'dressing_plant_staff' AND rp.permission_id NOT IN (SELECT id FROM permissions WHERE code = 'dressing_plant.access')));

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r JOIN permissions p
    ON (r.code = 'warehouse_staff' AND p.code = 'wms.access')
    OR (r.code = 'dressing_plant_staff' AND p.code = 'dressing_plant.access')
    OR (r.code = 'superadmin' AND p.code IN ('wms.access', 'dressing_plant.access'))
ON CONFLICT DO NOTHING;
