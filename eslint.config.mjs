import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'],
    },

    eslint.configs.recommended,

    ...tseslint.configs.recommended,

    {
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parserOptions: {
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },

    eslintPluginPrettierRecommended
);