-- 028_label_printer_role.sql
-- A role that can reach the product-label printer and nothing else.
--
-- The dressing plant hands the label station to a packing-line operator, not to
-- an office user. That account must not be able to browse the ledger, the price
-- lists, or anyone's payroll — it exists to print stickers. Rather than hand out
-- an existing role and trim it, this adds a permission of its own so "can print
-- labels" is expressible without dragging any other module along.
--
-- The permission is checked in three places, and all three matter:
--   * the label API routes reject a caller without it (the real boundary),
--   * the sidebar hides every other module (so the operator isn't offered doors
--     that will slam), and
--   * login sends a label-only user straight to the printer.

INSERT INTO permissions (code, module, action, name) VALUES
  ('dressing_plant.label.print', 'dressing_plant', 'create', 'Print product labels')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name, description) VALUES
  ('label_printer', 'Label printer',
   'Print dressed-product traceability labels. No access to any other module.')
ON CONFLICT (code) DO NOTHING;

-- The role gets exactly one permission — kept exact (not additive) so a re-run
-- after someone hand-grants extras restores the intended boundary.
DELETE FROM role_permissions rp
 USING roles r
 WHERE rp.role_id = r.id
   AND r.code = 'label_printer'
   AND rp.permission_id NOT IN (
         SELECT id FROM permissions WHERE code = 'dressing_plant.label.print'
       );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.code = 'label_printer'
   AND p.code = 'dressing_plant.label.print'
ON CONFLICT DO NOTHING;

-- Superadmin holds every permission, including the new one.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.code = 'superadmin'
   AND p.code = 'dressing_plant.label.print'
ON CONFLICT DO NOTHING;
