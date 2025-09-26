import js from '@eslint/js';
import pluginImport from 'eslint-plugin-import';
import pluginNode from 'eslint-plugin-n';
import pluginSecurity from 'eslint-plugin-security';
import pluginUnicorn from 'eslint-plugin-unicorn';

export default [
  // Root lint excludes web/; it is linted with its own config via package.json script
  { ignores: ['node_modules/**', 'dist/**', '.next/**', 'web/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      import: pluginImport,
      n: pluginNode,
      security: pluginSecurity,
      unicorn: pluginUnicorn
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly'
      }
    },
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
      'security/detect-object-injection': 'off',
      'unicorn/prefer-optional-catch-binding': 'error',
      // No TypeScript imports allowed
      'import/no-unresolved': ['error', { ignore: ['\\.ts$', '\\..*ts$'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program:has(ImportDeclaration[source.value=/.\\.ts$/])',
          message: 'TypeScript files are forbidden.'
        }
      ]
    }
  },
  {
    files: ['**/*.test.js', '**/*.spec.js', '**/*.test.jsx', '**/*.spec.jsx'],
    languageOptions: {
      globals: {
        test: 'readonly',
        expect: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        beforeEach: 'readonly',
        vi: 'readonly'
      }
    }
  }
];
