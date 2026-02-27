import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://celom.github.io',
  base: '/prose',
  integrations: [
    starlight({
      title: 'Prose',
      logo: {
        src: './src/assets/logomark.svg',
      },
      favicon: '/favicon.svg',
      description:
        'Declarative workflow DSL for orchestrating complex business operations in TypeScript',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/celom/prose',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/celom/prose/edit/main/apps/docs/',
      },
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { label: 'Getting Started', slug: 'getting-started' },
            { label: 'Core Concepts', slug: 'core-concepts' },
            { label: 'When to Use Prose', slug: 'comparison' },
          ],
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'guides' },
        },
        {
          label: 'API Reference',
          autogenerate: { directory: 'api' },
        },
        {
          label: 'Examples',
          autogenerate: { directory: 'examples' },
        },
        { label: 'MCP Server', slug: 'mcp' },
        { label: 'Credits', slug: 'credits' },
      ],
    }),
  ],
});
