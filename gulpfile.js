var browserify = require('browserify');
var gulp = require('gulp');
var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var uglify = require('gulp-uglify');
// var uglifyify = require('uglifyify');
var config = require('./package.json');
var del = require('del');
var rename = require('gulp-rename');
var path = require('path');
var babelify = require('babelify');
var gulpIf = require('gulp-if');
var watchify = require('watchify');
var localize = require('2k-utils/localize-cockpit-value');
var bundleOpts = config.twokBuildSettings.bundles;

gulp.task('build', function() {
    return Promise.all(bundleOpts.map(opts => {
        return del(path.join(opts.outputPath, '*'))
            .then(function(){
                return makeBundle(opts);
            })
    }));
});

function makeBundle(opts) {
    var fileName = opts.bundleName + (opts.uglify ? '.min.js' : '.js');
    var jsEntry = opts.jsEntry;
    var outputPath = opts.outputPath;
    var standaloneName = opts.standaloneName;

    var bundle = function() {
        return bundler.bundle()
            .on('error', function(err){
                console.log(err.toString());
                this.emit('end');
            })
            .pipe(source(fileName))
            .pipe(buffer())
            .pipe(gulpIf(opts.uglify, uglify({}).on('error', function(err) {
                console.error(err);
                this.emit('end');
            })))
            .pipe(gulp.dest(outputPath));
    };
    var bundleOpts = {
        paths: ['./node_modules', './2k_modules'],
        cache: {},
        packageCache: {}
    };
    bundleOpts.standalone = standaloneName;
    var bundler = browserify(bundleOpts);
    bundler.plugin(watchify);
    if (opts.babelify) {
        bundler.transform(babelify, {presets: ['es2015']});
    }
    // bundler.transform(uglifyify, {global: true, ignore: ['*.css', '*.pug']});
    bundler.add(jsEntry);

    bundler.on('update', bundle);
    bundler.on('log', msg => console.log(msg));
    bundler.on('error', err => console.error(err));

    return bundle();
}

gulp.task('default',['build']);
