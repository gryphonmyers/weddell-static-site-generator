var pathToRegexp = require('path-to-regexp');
var Router = require('weddell/src/plugins/router/router');
var pug = require("pug");
var fs = require('mz/fs');
var path = require('path');
var del = require('del');
var mkdirp = require('mkdirp-then');
var colors = require('colors');

var defaultPugOpts = {
    pretty: false
};


function parseTime(timestamp) {
    var date = new Date(timestamp);

    var hours = Math.floor(timestamp / 1000 / 60 / 60);
    timestamp -= hours * 1000 * 60 * 60;

    var mins = Math.floor(timestamp / 1000 / 60);
    timestamp -= mins * 1000 * 60;

    var secs = Math.floor(timestamp / 1000);

    return hours + ':' + mins + ':' + secs;
}

class Job {
    constructor() {
        this.redirects = [];
        this.filesToWrite = 0;
        this.filesWritten = 0;
    }
}

class WeddellStaticSiteGenerator {

    constructor(opts) {
        this.entryResolvers = opts.entryResolvers;
        this.pathSegmentResolvers = opts.pathSegmentResolvers;
        this.routes = opts.routes;
        this.router = new Router({ routes: this.routes });
        this.entryLocalNameResolvers = opts.entryLocalNameResolvers;
        this.templateMap = opts.templateMap;
        this.defaultTemplatePath = opts.defaultTemplatePath;
        this.defaultEntryResolver = opts.defaultEntryResolver;
        this.defaultPathSegmentResolver = opts.defaultPathSegmentResolver;
        this.defaultEntryLocalNameResolver = opts.defaultEntryLocalNameResolver;
        this.locals = opts.locals;
    }

    compileRoutes(outputPath, route, locals, params, jobObj){
        if (!locals) locals = Object.assign({}, this.locals);
        if (!params) params = {};

        var parsed = pathToRegexp.parse(route.pattern);

        return this.buildEntries(parsed, locals, route, null, outputPath, params, jobObj);
    }

    buildSite(outputPath) {
        var startTime = Date.now();
        return del(outputPath)
            .then(() => mkdirp(outputPath), err => {
                throw err;
            })
            .then(() => {
                var jobObj = new Job;
                return Promise.all(this.router.routes.map(route => this.compileRoutes(outputPath, route, null, null, jobObj)))
                    .then(result => {
                        console.log(colors.green("Done building site!"), "Job completed in " + colors.magenta(parseTime(Date.now() - startTime)), "Wrote " + jobObj.filesWritten + " files");
                        if (jobObj.redirects.length) {
                            console.warn(colors.yellow('Notice: some routes define redirects. You will need to respond to the "redirectTo" in the following templates in order to handle the actual redirection.'));
                            var templates = jobObj.redirects.reduce((finalObj, redirectObj) => {
                                if (!(redirectObj.templatePath in finalObj)) {
                                    finalObj[redirectObj.templatePath] = 1;
                                }
                                return finalObj;
                            }, {});
                            console.log(Object.keys(templates).map(template => '\t' + colors.magenta(template)).join('\r\n'));
                        }
                    })
                    .catch(err => {
                        console.error(colors.red(err), err.stack || '');
                        process.exit(1);
                    });
            });
    }

    resolveTemplateFunction(templateFilePath) {
        if (!this.constructor.compiledTemplates[templateFilePath]) {
            this.constructor.compiledTemplates[templateFilePath] = fs.readFile(templateFilePath, {encoding:'utf8'});
        }
        return this.constructor.compiledTemplates[templateFilePath]
            .then(function(contents){
                return pug.compile(contents, {filename: templateFilePath});
            }, err => {
                throw err;
            });
    }

    resolveEntries(paramName, routeName, locals) {
        var resolver = this._resolveProperty('entryResolvers', routeName, paramName, 'defaultEntryResolver');
        if (!resolver) throw "Failed to resolve entries for route " + routeName + " and param " + paramName;

        return Promise.resolve(typeof resolver === 'function' ? resolver.call(this, locals) : resolver);
    }

    _resolveProperty(prop, routeName, paramName, fallbackProp) {
        var result = (this[prop][routeName] && this[prop][routeName][paramName]);

        if (typeof result === 'undefined') {
            result = this[prop][paramName]
        }

        if (typeof result === 'undefined') {
            result = this[prop][fallbackProp]
        }

        return result;
    }

    resolvePathSegment(paramName, routeName, locals) {
        var resolver = this._resolveProperty('pathSegmentResolvers', routeName, paramName, 'defaultPathSegmentResolver');
        if (!resolver) throw "Failed to resolve path segment for route " + routeName + " and param " + paramName;

        return Promise.resolve(typeof resolver === 'function' ? resolver.call(this, locals) : resolver);
    }

    resolveEntryLocalName(paramName, routeName, locals) {
        var resolver = this._resolveProperty('entryLocalNameResolvers', routeName, paramName, 'defaultEntryLocalNameResolver');
        if (!resolver) throw "Failed to resolve entry local name for route " + routeName + " and param " + paramName;

        return Promise.resolve(typeof resolver === 'function' ? resolver.call(this, locals) : resolver);
    }

    resolveTemplatePath(componentName) {
        return (componentName && this.templateMap[componentName]) || this.defaultTemplatePath;
    }

    writeFile(route, finalPath, locals, params, jobObj) {
        var handler = route.handler ? (typeof route.handler === 'function' ? route.handler.call(this.router, {paramVals: params}) : route.handler) : null;
        var redirect = route.redirect ? (typeof route.redirect === 'function' ? route.redirect.call(this.router, {paramVals: params}) : route.redirect) : null;

        return Promise.resolve(handler)
            .then(componentName => {
                var templatePath = this.resolveTemplatePath(componentName);
                return templatePath ? templatePath : Promise.reject("Could not resolve a template path for component: " + componentName);
            })
            .then(templatePath => {
                return this.resolveTemplateFunction(templatePath)
                    .then(function(templateFunc){
                        return Promise.resolve(redirect)
                            .then(redirect => {
                                if (redirect) {
                                    locals = Object.assign({redirectTo: redirect}, locals);
                                    jobObj.redirects.push({from: finalPath, to: redirect, templatePath});
                                }
                                return templateFunc(locals);
                            })
                    })
                    .then(function(output) {
                        var filePath = path.join(finalPath, 'index.html');
                        console.log(colors.cyan('Writing file'), filePath);
                        return mkdirp(finalPath)
                            .then(() => fs.writeFile(filePath, output))
                            .then(result => {
                                jobObj.filesWritten++;
                                console.log(colors.green('Wrote file'), filePath);
                                return result;
                            })
                    });
            });
    }

    buildEntries(tokens, locals, route, pathArr, outputPath, params, jobObj) {
        if (!pathArr) pathArr = [];

        var currToken = tokens.length === pathArr.length ? null : tokens[pathArr.length];

        if (currToken) {
            if (typeof currToken === 'object') {
                if (currToken.name) {
                    return Promise.all([
                            this.resolveEntries(currToken.name, route.name, locals),
                            this.resolveEntryLocalName(currToken.name, route.name, locals)
                        ])
                        .then(result => {
                            var entries = result[0];
                            var entryLocalName = result[1];

                            return Promise.all(entries.map(entry => {
                                var entryLocals = Object.assign({}, locals);
                                entryLocals[entryLocalName] = entry;

                                return this.resolvePathSegment(currToken.name, route.name, entryLocals)
                                    .then(pathSegment => {
                                        return this.buildEntries(tokens, entryLocals, route, pathArr.concat(pathSegment), outputPath, params, jobObj);
                                    });
                            }))
                        });
                } else {
                    throw "No token name in path param '" + currToken + "'";
                }
            } else if (typeof currToken === 'string'){
                return this.buildEntries(tokens, locals, route, pathArr.concat(currToken), outputPath, params, jobObj);
            }
        } else {
            if (!route.name) throw "Route does not have a name - routes need names to be used with the static site generator: " + route.pattern;

            params = Object.assign({}, params, tokens.reduce((final, tok, ii) => {
                if (typeof tok === 'object' && tok.name) {
                    final[tok.name] = pathArr[ii];
                }
                return final;
            }, {}));

            try {
                var fullPath = path.join(outputPath, this.router.compileRouterLink({name: route.name, params }).fullPath)
            } catch (err) {
                throw "Failed compiling URL for route " + route.name + " " + err.toString();
            }

            jobObj.filesToWrite++;

            return this.writeFile(route, fullPath, locals, params, jobObj)
                .then(result => {
                    if (route.children) {
                        return Promise.all(route.children.map(childRoute => this.compileRoutes(outputPath, childRoute, locals, params, jobObj)));
                    }
                });
        }
    }
}

WeddellStaticSiteGenerator.compiledTemplates = {};

module.exports = WeddellStaticSiteGenerator;
