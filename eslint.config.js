import js from '@eslint/js';
import pluginImport from 'eslint-plugin-import';
import pluginNode from 'eslint-plugin-n';
import pluginSecurity from 'eslint-plugin-security';
import pluginUnicorn from 'eslint-plugin-unicorn';
import pluginReact from 'eslint-plugin-react';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', '.next/**', 'web/.next/**', 'web/out/**', 'coverage/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      import: pluginImport,
      n: pluginNode,
      security: pluginSecurity,
      unicorn: pluginUnicorn,
      react: pluginReact
    },
    settings: {
      'import/resolver': {
        node: { extensions: ['.js', '.jsx', '.json'] },
        alias: {
          map: [['@', './web']],
          extensions: ['.js', '.jsx', '.json']
        }
      },
      react: { version: 'detect' }
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
      'import/no-unresolved': ['error', { ignore: ['\\.ts$', '\\..*ts$'] }],
      'security/detect-object-injection': 'off',
      'unicorn/prefer-optional-catch-binding': 'error',
      'react/jsx-uses-vars': 'error',
      'react/react-in-jsx-scope': 'off'
    }
  },
  // Web app: browser globals
  {
    files: ['web/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly'
      }
    }
  },
  // Test files: Vitest globals
  {
    files: ['**/*.test.js', '**/*.spec.js', '**/*.test.jsx', '**/*.spec.jsx'],
    languageOptions: {
      globals: {
        test: 'readonly',
        expect: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        beforeEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        vi: 'readonly'
      }
    }
  }
];
