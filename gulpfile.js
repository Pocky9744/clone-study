'use strict';

// node modules
const fs = require('fs');
const path = require('path');
const gulp = require('gulp');
const browserSync = require('browser-sync');
const del = require('del');

// gulp modules
const sass = require('gulp-sass');
const postcss = require('gulp-postcss');
const handlebars = require('gulp-compile-handlebars');
const rename = require('gulp-rename');
const spritesmith = require('gulp.spritesmith');
const md5 = require('gulp-md5-plus');
const gulpif = require('gulp-if');
const plumber = require('gulp-plumber');
const cleanCSS = require('gulp-clean-css');
const gulpSort = require('gulp-sort');

// notification
const notify = require("gulp-notify");

// postcss
const autoprefixer = require('autoprefixer');
const urlRebase = require('postcss-url');


const paths = {
	root: './',
	html_path: 'src/',
	css_src: 'src/scss/',
	css_dest: 'src/css/',
	sprite_src: 'src/sprite/',
	sprite_dest: 'src/img/sprite/',
	img_dest: 'src/img/',
	build: 'dest/',
	css_build: 'dest/css/',
	img_build: 'dest/img/'
};

const date = new Date();

const config = {
	browserSync: true,
	notify: true,
	urlRebase: true,
	urlRebaseOption: {
		basePath: paths.img_dest,
		defaultUrl: 'https://ssl.pstatic.net/sstatic/search/mobile/recruit/img/',
		urlList: [{
			local: 'sprite/',
			remote: 'https://ssl.pstatic.net/sstatic/search/mobile/recruit/img/sprite/',
		}]
	},
	md5: true,
	uitIndexOption: {
		path: [path.join(paths.html_path,'*.html'),path.join(paths.html_path,'*.php')],
		options: {}
	},
	sprite_ratio: {
		png: 2,
		svg: 2,
	},
	svgToPng: false, // svg sprite png fallback 생성 여부
	autoprefixer: {
		browsers: ["Android > 0","iOS > 0","FirefoxAndroid > 0"] //모바일옵션
		// ['last 2 versions', "Edge > 0", "ie >= 8"] //PC옵션
	}
};

function getFolders(dir) {
	let result = [];

	if (fs.statSync(dir).isDirectory()) {
		result = fs.readdirSync(dir).filter((file) => fs.statSync(path.join(dir, file)).isDirectory());
	}

	return result;
}

const globalOptions = {
	notify: !config.notify ? {} : {
		errorHandler: notify.onError((error) => {
			console.error(error.stack);
			return "Error: <%= error.message %>";
		})
	}
}

const spritePng = makeSprite;

const spritePngBuild = gulp.series(spritePng, md5SpritePng);

const devTask = exports.dev = gulp.series(spritePng, devSass);
exports.build = gulp.series(buildSass, spritePngBuild, cssMinify);
exports.default = gulp.series(devTask, gulp.parallel(watch, runBrowserSync));
exports.watch = gulp.series(devTask, gulp.parallel(watch, runBrowserSync));
exports.sprite = gulp.parallel(spritePng);
exports.sass = devSass;
exports.minify = cssMinify;

function watch () {
	gulp.watch('**/*', {cwd: paths.css_src}, devSass);
	gulp.watch('**/*', {cwd: paths.sprite_src}, spritePng);
}

function makeSprite () {
	let stream_arr = [];
	let folders = getFolders(paths.sprite_src);
	var options = {
		spritesmith: (folder) => {
			return {
				imgPath: path.posix.relative(paths.css_dest, path.posix.join(paths.sprite_dest, 'sp_' + folder + '.png')),
				imgName: 'sp_' + folder + '.png',
				cssName: '_sp_' + folder + '.scss',
				cssFormat: 'scss',
				padding: 4,
				cssTemplate: './gulpconf/sprite_template.hbs',
				cssSpritesheetName: 'sp_' + folder,
				cssHandlebarsHelpers: {
					sprite_ratio: config.sprite_ratio.png
				}
			}
		},
	};

	folders.map(function(folder) {
		var spriteData = gulp.src(path.join(paths.sprite_src, folder, '*.png'))
			.pipe(plumber(globalOptions.notify))
			.pipe(gulpSort())
			.pipe(spritesmith(options.spritesmith(folder)));
		stream_arr.push(new Promise(function(resolve) {
			spriteData.img
				.pipe(gulp.dest(paths.sprite_dest))
				.on('end',resolve);
		}));
		stream_arr.push(new Promise(function(resolve) {
			spriteData.css
				.pipe(gulp.dest(path.join(paths.css_src, 'sprite')))
				.on('end', resolve);
		}));
	});

	stream_arr.push(makeSpriteMap(folders));
	return Promise.all(stream_arr);
}

function makeSpriteMap(folders) {
	var options = {
		maps: {
			handlebars: {
				prefix: 'sp_',
				exe: 'scss',
				path: path.posix.join(paths.css_src, 'sprite'),
				import: folders,
			}
		},
	};

	return new Promise(function(resolve) {
		gulp.src('gulpconf/sprite_maps_template.hbs')
			.pipe(plumber(globalOptions.notify))
			.pipe(handlebars(options.maps.handlebars))
			.pipe(rename('_sprite_maps.scss'))
			.pipe(gulp.dest(path.posix.join(paths.css_src, 'common')))
			.on('end', resolve);
	});
}

function devSass () {
	let gulpPipe = gulp.src(path.join(paths.css_src, '**/*.scss'), {sourcemaps: true})
		.pipe(plumber(globalOptions.notify))

	gulpPipe = sassPipe(gulpPipe);

	return gulpPipe
		.pipe(gulp.dest(paths.css_dest, {sourcemaps: '.'}))
		.pipe(gulpif(config.browserSync, browserSync.stream({match:'**/*.css'})));
}

function buildSass () {
	return Promise.all([
		del(path.join(paths.css_dest,'**/*.css.map')),
		new Promise(function(resolve) {
			let gulpPipe = gulp.src(path.join(paths.css_src, '**/*.scss'))
				.pipe(plumber(globalOptions.notify));

			gulpPipe = sassPipe(gulpPipe, true);

			gulpPipe
				.pipe(gulp.dest(paths.css_build))
				.on('end',resolve);
		})
	]);
}

function cssMinify () {
	var options = {
		cleanCSS: {
			'advanced' : false,           // 속성 병합 false
			'aggressiveMerging': false,   // 속성 병합 false
			'restructuring': false,       // 선택자의 순서 변경 false
			'mediaMerging': false,        // media query 병합 false
			'compatibility': 'ie7,ie8,*', // IE 핵 남김
		}
	};
	return gulp.src(path.join(paths.css_build, '*.css'))
		.pipe(cleanCSS(options.cleanCSS))
		.pipe(gulp.dest(paths.css_build));
}

function runBrowserSync (cb) {
	var options = {
		browserSync: {
			server: {
				baseDir: paths.root,
				directory: true
			},
			open: 'external',
		},
	};

	if (config.browserSync) {
		browserSync.init(options.browserSync);
		gulp.watch(paths.html_path+'**/*.html').on('change',browserSync.reload);
	} else {
		cb(null);
	}
}

function md5SpritePng (cb) {
	var options = {
		md5: {
			cssSrc: path.join(paths.css_build,'sprite/*.scss'), //이름 변경 대상 css(scss) 파일
			srcDel: false, // sprite 이름 변경전 파일 삭제 여부
			logDel: true, // 이전 생성된 md5 sprite 삭제 여부
		}
	}

	if(config.md5) {
		var del_sprite = [];
		var sprite_list = getFolders(paths.sprite_src);
		if (!sprite_list.length) return cb();

		for(var i=0,imax=sprite_list.length;i < imax;i++) {
			del_sprite.push(path.join(paths.sprite_dest,'sp_' + sprite_list[i] + '_????????.png'));
			sprite_list[i] = path.join(paths.sprite_dest,'sp_' + sprite_list[i] + '.png');
		}

		return del(del_sprite)
			.then(function() {
				return new Promise(function(resolve) {
					gulp.src(sprite_list)
						.pipe(plumber(globalOptions.notify))
						.pipe(md5(8,options.md5.cssSrc))
						.pipe(gulp.dest(paths.img_build))
						.on('end',resolve);
				});
			}).then(function() {
				if(options.md5.srcDel) {
					return del(sprite_list);
				}
			});
	}
}

function sassPipe(gulpPipe, build) {
	const autoprefixerOption = {
		browsers: config.autoprefixer.browsers
	};

	const ignoreWebkitBoxOrient = (root) => root.walkDecls('-webkit-box-orient', (decl) => decl.before(`${decl.raws.before}/* autoprefixer: ignore next */`));

	let options = {
		sass : {
			outputStyle: 'expanded',
			indentType: 'tab',
			indentWidth: 1
		},
		autoprefixer: autoprefixerOption,
		postcss: [ignoreWebkitBoxOrient, autoprefixer(autoprefixerOption)]
	};

	const urlRebaseProcess = (options) => {
		const { asset, basePath } = options;

		if (!config.urlRebaseOption.urlList) config.urlRebaseOption.urlList = [];

		const findPath = config.urlRebaseOption.urlList.find((value) => {
			const reBasePath = path.posix.join(basePath, value.local);
			return asset.url.indexOf(reBasePath) === 0;
		});

		if (findPath) {
			return findPath.remote + path.posix.relative(path.posix.join(basePath, findPath.local), asset.url);
		} else if (asset.url.indexOf(basePath) == 0) {
			return config.urlRebaseOption.defaultUrl + path.posix.relative(basePath, asset.url);
		} else {
			return asset.url;
		}
	}

	if(build && config.urlRebase) {
		options.postcss.push(urlRebase({
			basePath: path.relative(paths.css_dest,config.urlRebaseOption.basePath),
			url: (asset) => {
				let basePath = path.posix.relative(paths.css_dest, config.urlRebaseOption.basePath);
				return urlRebaseProcess({ asset, basePath })
			}
		}));
	}

	gulpPipe = gulpPipe.pipe(sass.sync(options.sass));
	if (build) {
		gulpPipe = gulpPipe.pipe(postcss(options.postcss));
	}

	return gulpPipe;
}
