import js from '@eslint/js';
import pluginImport from 'eslint-plugin-import';
import pluginNode from 'eslint-plugin-n';
import pluginSecurity from 'eslint-plugin-security';
import pluginUnicorn from 'eslint-plugin-unicorn';

export default [
  { ignores: ['node_modules/**', 'dist/**', '.next/**', 'coverage/**'] },
  js.configs.recommended,
  {
    plugins: { import: pluginImport, n: pluginNode, security: pluginSecurity, unicorn: pluginUnicorn },
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-implicit-coercion': 'error',
      'no-throw-literal': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'n/no-deprecated-api': 'error',
      'n/no-unsupported-features/es-builtins': 'error',
      'import/first': 'error',
      'import/no-duplicates': 'error',
      'import/newline-after-import': 'error',
      'import/no-unresolved': 'error',
      'security/detect-object-injection': 'off',
      'unicorn/prefer-optional-catch-binding': 'error',
      // No TypeScript imports allowed
      'import/no-unresolved': ['error', { ignore: ['\\.ts$', '\\..*ts$'] }],
      'no-restricted-syntax': [
        'error',
        { selector: 'Program:has(ImportDeclaration[source.value=/.\\.ts$/])', message: 'TypeScript files are forbidden.' }
      ]
    }
  }
];

