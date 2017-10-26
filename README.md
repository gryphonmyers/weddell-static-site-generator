


# weddell-static-site-generator
Generate a static site from a Weddell router object.

#### Example

routes.js:

```javascript
module.exports = [
    {
        name: 'homePage',
        pattern: '/:pageName/:localeCode?/',
        handler: function(evt) {
            switch (evt.paramVals.pageName) {
                case 'a':
                    return 'HomePageA';
                    break;
                case 'b':
                default:
                    return 'HomePageB';
                    break;
            }
        },
        children: [
            {
                name: 'mediaEntry',
                pattern: 'media/:mediaEntrySlug?/',
                handler: 'Media'
            }
        ]
    },
    {
        name: 'splashPage',
        pattern: '/',
        handler: function() {
            return 'SplashPage'
        },
        children: []
    },
    {
        name: 'buyPageRedirect',
        pattern: '/buy/:localeCode?',
        redirect: function(params){
            return this.compileRouterLink({name: 'retail', params: { pageName: '2k18', localeCode: params.localeCode}}).fullPath;
        }
    }
];

```

build.js
```javascript
var WeddellSiteGenerator = require('weddell-static-site-generator');

var buildOpts = {
    routes,
    entryResolvers: {
        homePage: {
            localeCode: () => locales
        },
        localeCode: locals => locales,
        mediaEntrySlug: locals => {
            switch(locals.page.name_slug) {
                case '2k18':
                    return dataSources.mediaSource.find().then(entries => {
                        return entries.map(entry => localize(entry, locals.locale))
                    })
                case 'vr':
                    return dataSources.VRMediaSource.find().then(entries => {
                        return entries.map(entry => localize(entry, locals.locale))
                    })
                default:
                    return dataSources.mediaSource.find().then(entries => {
                        return entries.map(entry => localize(entry, locals.locale))
                    })
            }
        },
        newsEntrySlug: locals => dataSources.newsSource.find().then(entries => {
            return entries.map(entry => localize(entry, locals.locale))
        }),
        pageName: locals => [
            {
                name_slug: 'a'
            },
            {
                name_slug: 'b'
            }
        ]
    },
    pathSegmentResolvers: {
        localeCode: locals => locals.locale.code === primaryLocale ? null : locals.locale.code,
        newsEntrySlug: locals => locals.newsEntry.name_slug,
        mediaEntrySlug: locals => locals.mediaEntry.name_slug,
        pageName: locals => locals.page.name_slug
    },
    entryLocalNameResolvers: {
        localeCode: () => 'locale',
        mediaEntrySlug: () => 'mediaEntry',
        newsEntry : {
            newsEntrySlug: () => 'newsEntry'
        },
        pageName: () => 'page'
    },
    defaultTemplatePath: './src/markup/stub.pug',
    templateMap: {
        'HomePage': './src/markup/stub.pug',
        'SplashPage': './src/markup/stub.pug',
        'Uberfeed': './src/markup/stub.pug',
        'News': './src/markup/news.pug',
        'Retail': './src/markup/stub.pug',
        'Media': './src/markup/media.pug'
    },
    locals: {
        favicons: [],
        stylesheets: [],
        scripts: []
    }
};

new WeddellSiteGenerator(buildOpts)
    .buildSite('site/output/path');
```
