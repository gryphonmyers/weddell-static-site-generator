var pathToRegexp = require('path-to-regexp');
var Router = require('weddell/src/plugins/router/router');
var pug = require("pug");
var fs = require('mz/fs');
var path = require('path');
var del = require('del');
var mkdirp = require('mkdirp-then');
var colors = require('colors');
var defaults = require('lodash/defaultsDeep');

var defaultPugOpts = {
    pretty: false
};

var logLevels = {
    'normal': 0,
    'verbose': 1,
    'debug': 2
};

var defaultOpts = {
    logLevel: 'normal'
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
        this.numFilesToWrite = 0;
        this.numFilesWritten = 0;
        this.filesWritten = [];
        this.pathsWritten = [];
        this.queue = {};
    }

    enqueue(outputPath, routeIndex, depth, func) {
        var newObj = {routeIndex, depth, func};
        if (outputPath in this.queue) {
            this.queue[outputPath] = this.queue[outputPath].depth > depth ? this.queue[outputPath] : this.queue[outputPath].depth < depth ? newObj : this.queue[outputPath].routeIndex > routeIndex ? this.queue[outputPath] : this.queue[outputPath].routeIndex < newObj ? newObj : newObj;
        } else {
            this.queue[outputPath] = newObj;
        }
    }

    write() {
        return Promise.all(Object.values(this.queue).map(val => val.func()));
    }
}

class WeddellStaticSiteGenerator {

    constructor(opts) {
        opts = defaults(opts, defaultOpts);
        this.logLevel = logLevels[opts.logLevel];
        this.entryResolvers = opts.entryResolvers;
        this.pugOpts = defaults(opts.pugOpts, defaultPugOpts);
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
        this.localsTransform = opts.localsTransform;
        this.clean = opts.clean;
    }

    compileRoute(outputPath, route, locals, params, jobObj, prevTokens, routeIndex, depth){
        if (!locals) locals = Object.assign({}, this.locals);
        if (!params) params = {};
        if (!prevTokens) prevTokens = []

        var tokens = pathToRegexp.parse(route.pattern);

        return this.buildEntries(tokens, locals, route, null, outputPath, params, jobObj, prevTokens, routeIndex, depth);
    }

    buildSite(outputPath) {
        var startTime = Date.now();
        console.log(colors.cyan("Starting Weddell site build, please wait..."));
        return Promise.resolve(this.clean ? del(outputPath)
            .then(() => mkdirp(outputPath), err => {
                throw err;
            }) : null)
            .then(() => {
                var jobObj = new Job;
                return Promise.all(this.router.routes.map((route, ii) => this.compileRoute(outputPath, route, null, null, jobObj, null, ii, 0)))
                    .then(result => {
                        var resolveTime = Date.now();
                        console.log("Resolved " + colors.green(Object.keys(jobObj.queue).length) + " files to write in " + colors.magenta(parseTime(resolveTime - startTime)) + ". Starting file writes...");
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
                        return jobObj.write()
                            .then(() => {
                                var writeTime = Date.now();
                                console.log("Done writing files in " + colors.magenta(parseTime(writeTime - resolveTime)) + ". Job took " + colors.magenta(parseTime(writeTime - startTime)) + " in total.");
                                return jobObj;
                            });
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
            .then((contents) => {
                return pug.compile(contents, defaults({filename: templateFilePath}, this.pugOpts));
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

    writeFile(route, finalPath, locals, params, jobObj, outputPath) {
        var handler = route.handler ? (typeof route.handler === 'function' ? route.handler.call(this.router, {paramVals: params}) : route.handler) : null;
        var redirect = route.redirect ? (typeof route.redirect === 'function' ? route.redirect.call(this.router, {paramVals: params}) : route.redirect) : null;

        return Promise.resolve(handler)
            .then(componentName => {
                var templatePath = this.resolveTemplatePath(componentName);
                Object.assign(locals, {componentName});
                return templatePath ? templatePath : Promise.reject("Could not resolve a template path for component: " + componentName);
            }, err => {
                if (err && typeof err === 'object' ) {
                    redirect = this.router.compileRouterLink(Object.assign({}, err, {params: Object.assign({}, locals, err.params)})).fullPath;
                } else if (err && typeof err === 'string') {
                    redirect = err;
                }
                return this.resolveTemplatePath(null);
            })
            .then(templatePath => {
                return this.resolveTemplateFunction(templatePath)
                    .then((templateFunc) => {
                        return Promise.resolve(redirect)
                            .then(redirect => {
                                locals = Object.assign({ path: finalPath, route, router: this.router, params }, locals);
                                if (redirect) {
                                    locals = Object.assign(locals, {redirectTo: redirect});
                                    jobObj.redirects.push({from: finalPath, to: redirect, templatePath});
                                }
                                if (this.localsTransform) {
                                    return Promise.resolve(this.localsTransform(locals))
                                        .then(locals => {
                                            return templateFunc(locals);
                                        });
                                }
                                return templateFunc(locals);
                            })
                    })
                    .then(function(output) {
                        var origPath = finalPath;
                        finalPath = path.join(outputPath, finalPath);
                        var filePath = path.join(finalPath, 'index.html');
                        if (this.logLevel >= 1) {
                            console.log(colors.cyan('Writing file'), filePath);
                        }
                        return mkdirp(finalPath)
                            .then(() => fs.writeFile(filePath, output))
                            .then(result => {
                                jobObj.pathsWritten.push(origPath);
                                jobObj.filesWritten.push(filePath);
                                jobObj.numFilesWritten++;
                                if (this.logLevel >= 1) {
                                    console.log(colors.green('Wrote file'), filePath);
                                }
                                return result;
                            })
                    }.bind(this));
            });
    }

    buildEntry(tokens, locals, route, pathArr, outputPath, params, jobObj, routeIndex, depth) {
        if (!route.name) throw "Route does not have a name - routes need names to be used with the static site generator: " + route.pattern;
        
        params = Object.assign({}, params, tokens.reduce((final, tok, ii) => {
            if (typeof tok === 'object' && tok.name) {
                final[tok.name] = pathArr[ii];
            }
            return final;
        }, {}));
        locals = Object.assign({routeName: route.name}, locals);

        try {
            var fullPath = this.router.compileRouterLink({name: route.name, params }).fullPath;
        } catch (err) {
            throw "Failed compiling URL for route " + route.name + " " + err.toString();
        }

        var matches = this.router.matchRoute(fullPath, this.routes);
        
        if (matches) {
            if (matches[matches.length - 1].route === route) {
                jobObj.enqueue(fullPath, routeIndex, depth, this.writeFile.bind(this, route, fullPath, locals, params, jobObj, outputPath));
            }
        }
    }

    buildEntries(tokens, locals, route, pathArr, outputPath, params, jobObj, prevTokens, routeIndex, depth) {
        if (!pathArr) pathArr = [];
        if (!locals) locals = {};

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
                            if (!entries || !entryLocalName) {
                                throw "Missing entries or entry local name for param '" + currToken.name + "'";
                            }

                            return Promise.all(entries.map(entry => {
                                var entryLocals = Object.assign({}, locals);
                                if (entryLocalName === currToken.name) {
                                    throw "Cannot set entry local name to be the same as the path var name: " + entryLocalName;
                                }
                                entryLocals[entryLocalName] = entry;

                                return this.resolvePathSegment(currToken.name, route.name, entryLocals)
                                    .then(pathSegment => {
                                        entryLocals[currToken.name] = pathSegment;
                                        return {locals: entryLocals, pathSegment};
                                    });
                            }))
                            .then(entryObjs => {
                                if (currToken.optional && !entryObjs.some(obj => !obj.locals[currToken.name])) {
                                    var newObj = {};
                                    newObj[currToken.name] = null;
                                    entryObjs.push({locals: Object.assign(newObj, locals), pathSegment: null })   
                                }

                                return Promise.all(entryObjs.map(obj => {
                                    return this.buildEntries(tokens, obj.locals, route, pathArr.concat(obj.pathSegment), outputPath, params, jobObj, prevTokens, routeIndex, depth)
                                }));
                            })
                        });
                } else {
                    throw "No token name in path param '" + currToken + "'";
                }
            } else if (typeof currToken === 'string'){
                return this.buildEntries(tokens, locals, route, pathArr.concat(currToken), outputPath, params, jobObj, prevTokens, routeIndex, depth);
            }
        } else {
            var promises = [];
            // if (typeof tokens[tokens.length - 1] === 'string') { Don't 100% remember why we were checking this. It was messing some things up.
            promises.push(this.buildEntry(tokens, locals, route, pathArr, outputPath, params, jobObj, routeIndex, depth));
            // }
            
            if (route.children) {
                params = Object.assign({}, params, tokens.reduce((final, tok, ii) => {
                    if (typeof tok === 'object' && tok.name) {
                        final[tok.name] = pathArr[ii];
                    }
                    return final;
                }, {}));
                promises = promises.concat(route.children.map((childRoute, ii) => this.compileRoute(outputPath, childRoute, locals, params, jobObj, prevTokens.concat(tokens), ii, depth + 1)));
            }
            return Promise.all(promises)
                .then(() => jobObj);
        }
    }
}

WeddellStaticSiteGenerator.compiledTemplates = {};

module.exports = WeddellStaticSiteGenerator;
