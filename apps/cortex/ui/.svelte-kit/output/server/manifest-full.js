export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["favicon.svg"]),
	mimeTypes: {".svg":"image/svg+xml"},
	_: {
		client: {start:"_app/immutable/entry/start.CUyH0Glq.js",app:"_app/immutable/entry/app.Dej_sjb9.js",imports:["_app/immutable/entry/start.CUyH0Glq.js","_app/immutable/chunks/DMN-gTPG.js","_app/immutable/chunks/DcYH6ZLs.js","_app/immutable/chunks/CGXFW_Hb.js","_app/immutable/entry/app.Dej_sjb9.js","_app/immutable/chunks/DcYH6ZLs.js","_app/immutable/chunks/Bb9npD4X.js","_app/immutable/chunks/DoA4ZXDq.js","_app/immutable/chunks/CGXFW_Hb.js","_app/immutable/chunks/BAmVDMWh.js","_app/immutable/chunks/uMs3N5ls.js","_app/immutable/chunks/CaYERXHo.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/3.js')),
			__memo(() => import('./nodes/4.js')),
			__memo(() => import('./nodes/5.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/run",
				pattern: /^\/run\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/run/[runId]",
				pattern: /^\/run\/([^/]+?)\/?$/,
				params: [{"name":"runId","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/workshop",
				pattern: /^\/workshop\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
