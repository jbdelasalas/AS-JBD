-- 003_demo_user.sql
-- Seed an initial superadmin user.
--
-- Email:    admin@perpet.com.ph
-- Password: Perpet2026!
--
-- The password_hash below is a bcrypt hash with cost 10. Change this immediately.
--
-- To regenerate:
--   node -e "console.log(require('bcryptjs').hashSync('Perpet2026!', 10))"

INSERT INTO users (id, email, password_hash, full_name, is_active, is_superadmin)
VALUES (
  '99999999-9999-9999-9999-999999999999',
  'admin@perpet.com.ph',
  '$2a$10$JU4exaCJSV7dLXA.Uq53pO1wMJFJxgE/sYPBWLzI8bf3eaL.7uH0y',  -- Perpet2026!
  'System Administrator',
  true,
  true
) ON CONFLICT (id) DO NOTHING;

-- Assign superadmin role for the demo company
INSERT INTO user_roles (user_id, role_id, company_id)
SELECT '99999999-9999-9999-9999-999999999999', r.id, '11111111-1111-1111-1111-111111111111'
FROM roles r WHERE r.code = 'superadmin'
ON CONFLICT DO NOTHING;
