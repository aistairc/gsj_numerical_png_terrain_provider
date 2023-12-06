const path		= require( 'path' );
module.exports = {
  context: __dirname,
  entry: {
    index	: path.join( __dirname, 'src', 'index.ts' )
  },
  output: {
    path: path.resolve( __dirname, 'dist' ),
    filename: 'NumericalPngTerrainProvider.js',
    libraryTarget: 'umd',
    globalObject: 'this'
  },
  module: {
  rules: [{
    test: /\.ts$/,
    use: "ts-loader",
  }]
  },
  resolve:	{
    fallback:	{
      url: false,		//20221105 depends on webpack version ?
      zlib: false,	//20221105 depends on webpack version ?
      https: false,	//20221105 depends on webpack version ?
      http: false,	//20221105 depends on webpack version ?
    },
    extensions:	[".ts", ".js"]
  },
  mode: 'development',
};