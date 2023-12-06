//******************************************************************************
//NumericalPngTerrainProvider
//標高数値PNGタイル用TerrainProvider（隣接タイルギャップ対応・法線ベクトル対応）
//Terrain provider for numerical png tile of elevation
//resolved tile boundary joint problem, normal vector
//using decimated grid height map not rtin
/*!
 *	@name	: NumericalPngTerrainProvider
 *	@description	: Terrain provider for numerical png tile of elevation.
 *	@version	: 2.0.0
 *	@released	: 20231120
 *	@required	: Cesium
 *	@author	: Kaoru KITAO
 *	@email	: kaoru@kitao.net
 *      @copyright      : 2023, National Institute of Advanced Industrial Science and Technology (AIST)
 *      @license        : Apache License, Version 2.0
*/

//******************************************************************************
//タイルシステムのキャッシングシステム
//TileCacherクラス
class TileCacher {
	//**************************************************************************
	//メンバ変数
	caches	= [];	//キャッシュ格納
	size;	//キャッシュ上限数

	//**************************************************************************
	//コンストラクタ
	/*
		@param	number	: count for tiles to cache
	*/
	constructor ( size ) {
		//----------------------------------------------------------------------
		//キャッシュを格納する配列の初期化とキャッシュの上限を設定
		this.size	= Cesium.defaultValue( size, 256 );
	}

	//**************************************************************************
	//タイル座標を指定してキャッシュを取得
	/*
		@param	number	: x coordinate of tile
		@param	number	: y coordinate of tile
		@param	number	: level coordinate of tile
		@return	mixed	: object or undefined
	*/
	get ( x, y, level ) {
		//----------------------------------------------------------------------
		//タイル座標が合致するデータを探し、見つかればタイムスタンプを更新する
		const match	= this.caches.find(( element ) => {
			const match	= element.x === x
			&& element.y === y
			&& element.level === level;
			if ( match ) {
				element.timestamp	= Date.now();
			}
			return match;
		});
		//----------------------------------------------------------------------
		//結果を返す：処理中に要素が破棄される可能性があるため多重チェック
		return match === void( 0 )
		? void( 0 )
		: typeof match === 'object' ?? !Array.isArray( match )
		? void( 0 )
		: match.value === void( 0 )
		? void( 0 )
		: structuredClone( match.value );
	}

	//**************************************************************************
	//キャッシュを登録
	/*
		@param	number	: x coordinate of tile
		@param	number	: y coordinate of tile
		@param	number	: level coordinate of tile
		@param	mixed	: value for tile coordinates
		@return	object	: registered object
	*/
	add ( x, y, level, value ) {
		//----------------------------------------------------------------------
		//タイムスタンプを決める
		const timestamp	= Date.now();
		//----------------------------------------------------------------------
		//タイル座標が合致する要素の取得を試みる
		const element	= this.caches.find(( element ) => {
			//タイル座標の合致を調べる
			const match	= element.x === x
			&& element.y === y
			&& element.level === level;
			//タイル座標の合致があれば値とタイムスタンプを上書きする
			if ( match ) {
				element.timestamp	= timestamp;
				element.value	= value;
			}
			//合致の結果を返す
			return match;
		});
		//----------------------------------------------------------------------
		//合致する要素がない場合は値を登録する
		if ( element === void( 0 )) {
			this.caches.push({
				x, y, level, value, timestamp,
			});
		}
		//----------------------------------------------------------------------
		//キャッシュを掃除する
		this.clean();
		//----------------------------------------------------------------------
		//参照を返す
		return this;
	}

	//**************************************************************************
	//キャッシュを掃除
	/*
		@return	this
	*/
	clean () {
		//----------------------------------------------------------------------
		//キャッシュをタイムスタンプの降順で並べて指定件数分以降の要素を破棄
		this.caches.sort(( a, b ) => {
			return b.timestamp - a.timestamp;
		}).splice( this.size );
		//----------------------------------------------------------------------
		//参照を返す
		return this;
	}
};

//******************************************************************************
//NumericalPngTerrainProviderクラス
class NumericalPngTerrainProvider {
	//**************************************************************************
	//メンバ変数
	//--------------------------------------------------------------------------
	//初期値固定
	hasWaterMask		= false;
	ready				= true;
	readyPromise		= Promise.resolve( true );
	//--------------------------------------------------------------------------
	//コンストラクタで設定（初期値あり）
	url;
	credit;
	maximumLevel;
	ellipsoid;
	tileWidth;
	heightScale;
	heightInvalidValue;
	hasVertexNormals;
	heightmapWidth;
	zeroRectangleLimit;
	//--------------------------------------------------------------------------
	//コンストラクタで生成
	tilingScheme;
	availability;
	errorEvent;
	indices;
	//--------------------------------------------------------------------------
	//コンストラクタで生成（キャッシュ）
	cacheObj;

	//**************************************************************************
	//コンストラクタ
	/*
		@param	mixed	: undefined or object, see NumericalPngTerrainProviderOpts
					{
						url			: tile url template
						credit		: string or Cesium Credit instance
						ellipsoid	: Cesium Ellipsoid instance
						tileWidth	: tile width
						heightScale	: scale for pixel value to meter
						maximumLevel	: available max zoom level of tiles
						heightInvalidValue	: invalid value
						useVertexNormals	: use or not vertex normals
						heightmapWidth	: reduced height map width
						zeroRectangleLimit	: tile radian max size to calculate
						cacheSize	: number of caching tiles
					}
	*/
	constructor ( options ) {
		//----------------------------------------------------------------------
		//引数の整理
		const opts	= Cesium.defaultValue( options, {});
		//----------------------------------------------------------------------
		//メンバ変数初期値設定
		this.url	= Cesium.defaultValue(
			// opts.url, 'https://tiles.gsj.jp/tiles/elev/mixed/{z}/{y}/{x}.png'
			opts.url, 'https://tiles.gsj.jp/tiles/elev/land/{z}/{y}/{x}.png'
		);
		this.credit	= typeof opts.credit === 'string'
		? new Cesium.Credit( opts.credit )
		: opts.credit instanceof Cesium.Credit
		? opts.credit
		: new Cesium.Credit([
			'<a href="https://gbank.gsj.jp/seamless/elev/">',
			'Seamless Elevation Tiles',
			'</a>'
		].join( '' ));
		this.ellipsoid		= Cesium.defaultValue( opts.ellipsoid, Cesium.Ellipsoid.WGS84 );
		this.tileWidth		= Cesium.defaultValue( opts.tileWidth, 256 );
		this.heightScale	= Cesium.defaultValue( opts.heightScale, 0.01 );
		this.maximumLevel	= Cesium.defaultValue( opts.maximumLevel, 14 );
		this.heightInvalidValue	= opts.heightInvalidValue === void( 0 )
		? -8388608
		: opts.heightInvalidValue === null
		? 0
		: opts.heightInvalidValue;
		this.hasVertexNormals	= Cesium.defaultValue( opts.useVertexNormals, false );
		this.heightmapWidth	= Cesium.defaultValue( opts.heightmapWidth, 65 );
		// this.zeroRectangleLimit	= Cesium.defaultValue( opts.zeroRectangleLimit, Math.PI / 180 * 0.5 );
		this.zeroRectangleLimit	= Cesium.defaultValue( opts.zeroRectangleLimit, false );
		const cacheSize		= Cesium.defaultValue( opts.cacheSize, 100 );
		//----------------------------------------------------------------------
		//標高マップの頂点インデックスを16ビットに抑える
		if ( this.heightmapWidth > 256 ) {
			throw new Error( '"heightmapWidth" must be equal or less than 256.' );
		}
		//----------------------------------------------------------------------
		//メンバ変数インスタンス生成（初期値設定後に決まる）
		this.tilingScheme	= new Cesium.WebMercatorTilingScheme({
			numberOfLevelZeroTilesX: 1,
			numberOfLevelZeroTilesY: 1,
			ellipsoid: this.ellipsoid,
		});
		this.availability	= new Cesium.TileAvailability(
			this.tilingScheme,
			this.maximumLevel
		);
		this.errorEvent	= new Cesium.Event();
		this.errorEvent.addEventListener( console.log, this );
		//----------------------------------------------------------------------
		//キャッシュ管理インスタンス
		this.cacheObj	= new TileCacher( cacheSize );
		//----------------------------------------------------------------------
		//標高マップの各種インデックスを生成しておく（全タイル共通）
		this.indices	= this.createIndices( this.heightmapWidth );
	}

	//**************************************************************************
	//標高マップジオメトリの頂点番号を整理する
	/*
		@param	number	: height map width
		@return	object	: triangle vertex indices object
	*/
	createIndices ( heightmapWidth ) {
		//----------------------------------------------------------------------
		//結果を格納するオブジェクトを用意
		const indices	= {
			all: new Uint16Array(( heightmapWidth - 1 ) ** 2 * 6 ),
			north: [],
			south: [],
			west: [],
			east: []
		}
		//----------------------------------------------------------------------
		//全体用
		//1行目のジオメトリ頂点番号を整理
		const rowIndices	= new Uint16Array(( heightmapWidth - 1 ) * 6 );
		for ( let x = 0; x < heightmapWidth - 1; x ++ ) {
			rowIndices[ x * 6 + 0 ]	= x;
			rowIndices[ x * 6 + 1 ]	= x + heightmapWidth + 1;
			rowIndices[ x * 6 + 2 ]	= x + 1;
			rowIndices[ x * 6 + 3 ]	= x;
			rowIndices[ x * 6 + 4 ]	= x + heightmapWidth;
			rowIndices[ x * 6 + 5 ]	= x + heightmapWidth + 1;
		}
		//1行目の頂点番号に幅ピクセル数を加算して順次登録
		for ( let y = 0; y < heightmapWidth - 1; y ++ ) {
			indices.all.set(
				rowIndices.map(( value ) => value + heightmapWidth * y ),
				rowIndices.length * y
			);
		}
		//----------------------------------------------------------------------
		//東西南北橋端用
		for ( let i = 0; i < heightmapWidth; i ++ ) {
			indices.north.push( i );
			indices.south.push( i + heightmapWidth * ( heightmapWidth - 1 ));
			indices.west.push( i * heightmapWidth );
			indices.east.push( i * heightmapWidth + heightmapWidth - 1 );
		}
		//----------------------------------------------------------------------
		//結果を返す
		return indices;
	}

	//**************************************************************************
	//タイルを要求して標高データを作って返す
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@return	mixed	: QuantizedMeshTerrainData or HeightmapTerrainData instance
	*/
	async requestTileGeometry ( x, y, level ) {
		//----------------------------------------------------------------------
		//キャッシュを探す
		const cached	= this.cacheObj.get( x, y, level );
		//----------------------------------------------------------------------
		//キャッシュの有無で分岐
		if ( cached !== void( 0 )) {
			//キャッシュがあればそれを返す
			return cached;
		} else {
			//キャッシュがなければデータを作ってキャッシュし、作ったデータを返す
			const cache	= await this.createTileGeometry( x, y, level );
			this.cacheObj.add( x, y, level, cache );
			return cache;
		}
	}

	//**************************************************************************
	//標高データを作る
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@return	mixed	: QuantizedMeshTerrainData or HeightmapTerrainData instance
	*/
	async createTileGeometry ( x, y, level ) {
		//----------------------------------------------------------------------
		//主タイルに右、下、右下の各タイルを並べたcanvasを作る
		const tile	= await this.createSynthesizedTile( x, y, level );
		//----------------------------------------------------------------------
		//作った結果で分岐
		if ( tile instanceof HTMLCanvasElement ) {
			//canvasが返された場合
			//contextを取得
			const context	= tile.getContext( '2d' );
			//context取得成否で分岐
			if ( context instanceof CanvasRenderingContext2D ) {
				//取得成功時はterrainを作り標高データを生成して返す
				const terrain	= this.imageDataToTerrain(
					context.getImageData( 0, 0, tile.width, tile.height ),
					this.heightScale
				);
				return this.createQuantizedMeshData( x, y, level, terrain );
			} else {
				//取得失敗時は空の標高マップを返す
				return this.emptyHeightmap();
			}
		} else {
			//canvas以外が返された場合は空の標高マップを返す
			return this.emptyHeightmap();
		}
	}

	//**************************************************************************
	//主、右、下、右下の合成タイルを作る
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@return	mixed	: canvas or false
	*/
	async createSynthesizedTile ( x, y, level ) {
		//----------------------------------------------------------------------
		//主、右、下、右下のタイルを取得するプロミス配列を作る
		const promises	= [
			[ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ 1, 1 ]
		].map(( value ) => {
			//ズームレベル0と右端タイルの場合を考慮して取得タイルのx座標を決める
			const tileX	= level === 0
			? 0
			: x + value[0] < 2 ** level
			? x + value[0]
			: 0;
			//タイル取得プロミスを返す
			return this.fetchTile( tileX, y + value[1], level, this.url );
		});
		//----------------------------------------------------------------------
		//プロミス配列の処理を待って結果を返す
		return await Promise.all( promises ).then(
			( values ) => {
				//主タイル取得成否で分岐
				if (
					values[0] instanceof HTMLImageElement
					|| values[0] instanceof HTMLCanvasElement
				) {
					//主タイル（画像）取得成功時
					//canvasを作る
					const canvas	= document.createElement( 'canvas' );
					canvas.width	= canvas.height	= this.tileWidth + 1;
					//context取得
					const context	= canvas.getContext( '2d' );
					//context取得成功時のみ処理
					if ( context instanceof CanvasRenderingContext2D ) {
						//4つのタイルの取得結果を走査して処理
						values.forEach(( value, index ) => {
							//タイル貼付け位置を決める
							const x	= ( index % 2 ) * this.tileWidth;
							const y	= Math.floor( index / 2 ) * this.tileWidth;
							//タイル取得成功時のみ貼り付け
							if (
								value instanceof HTMLImageElement
								|| value instanceof HTMLCanvasElement
							) {
								context.drawImage( value, x, y );
							}
						});
					}
					//canvasを返す
					return canvas;
				} else {
					//主タイル取得失敗時はfalseを返す
					return false;
				}
			}
		);
	}

	//**************************************************************************
	//タイルを取得する
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@param	string	: tile url template
		@return	promise	: image or false
	*/
	fetchTile ( x, y, level, url ) {
		//----------------------------------------------------------------------
		//プロミスを返す
		return new Promise(( resolve ) => {
			//画像要素を用意
			const img	= new Image();
			//CORS設定
			img.crossOrigin	= 'anonymous';
			//取得成功時処理：画像要素を返す
			img.addEventListener( 'load', ( event ) => {
				resolve( event.target );
			});
			//取得失敗時処理：falseを返す
			img.addEventListener( 'error', () => {
				resolve( false );
			});
			//タイルURLテンプレートにタイル座標を適用して画像を要求する
			img.src	= url.replace( '{x}', String( x ))
				.replace( '{y}', String( y ))
				.replace( '{z}', String( level ));
		});
	}

	//**************************************************************************
	//空（標高値が全て0）のterrainデータを返す
	/*
		@return	object	: HeightmapTerrainData instance
	*/
	emptyHeightmap () {
		//----------------------------------------------------------------------
		//インスタンスを生成して返す
		return new Cesium.HeightmapTerrainData({
			buffer: new Uint8Array( 4 ),
			width: 2,
			height: 2,
		});
	}

	//**************************************************************************
	//imageDataを間引いてterrainに変換する
	/*
		@param	object	: imageData
		@param	number	: heightScale
		@return	typed	: optimized terrain data
	*/
	imageDataToTerrain ( imageData, scale ) {
		//----------------------------------------------------------------------
		//空の型付配列を用意
		const terrain	= new Float32Array( this.heightmapWidth ** 2 );
		//----------------------------------------------------------------------
		//データ採用間隔を決める（この間隔で標高データを間引く）
		const wInterval	= ( imageData.width - 1 ) / ( this.heightmapWidth - 1 );
		const hInterval	= ( imageData.height - 1 ) / ( this.heightmapWidth - 1 );
		//----------------------------------------------------------------------
		//imageDataを走査
		for ( let y = 0; y < this.heightmapWidth; y ++ ) {
			//取得元のy座標
			const srcY	= Math.round( y * hInterval );
			for ( let x = 0; x < this.heightmapWidth; x ++ ) {
				//取得元のx座標
				const srcX	= Math.round( x * wInterval );
				//取得元のインデックス値（rgba4要素で4倍）
				const index	= ( srcY * imageData.width + srcX ) * 4;
				//rgba配列を取得
				const rgba	= imageData.data.slice( index, index + 4 );
				//terrainに標高値をセット
				terrain[ y * this.heightmapWidth + x ]	= this.rgbaToHeight(
					rgba, scale
				);
			}
		}
		//----------------------------------------------------------------------
		//結果を返す
		return terrain;
	}

	//**************************************************************************
	//rgba配列から標高を求める
	/*
		@param	typed	: typed rgba
		@param	number	: heightScale
		@return	number	: elevation
	*/
	rgbaToHeight ( rgba, scale ) {
		//----------------------------------------------------------------------
		//符号付きでピクセル値を計算
		const value	= rgba[0] * 65536 + rgba[1] * 256 + rgba[2] - (
			rgba[0] < 128 ? 0 : 16777216
		);
		//----------------------------------------------------------------------
		//無効値を0にして、スケールを乗じて返す
		return (
			rgba[3] === 0 || value === this.heightInvalidValue ? 0 : value
		) * scale;
	}

	//**************************************************************************
	//terrainを量子化して返す
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@param	typed	: terrain data
		@return	object	: QuantizedMeshTerrainData or HeightmapTerrainData instance
	*/
	createQuantizedMeshData ( x, y, level, terrain ) {
		//----------------------------------------------------------------------
		//省略名を決めておく
		const size	= this.heightmapWidth;
		const R	= this.ellipsoid.maximumRadius;
		//----------------------------------------------------------------------
		//量子化時の最大値（最小値は0）
		const quantizedMax	= 32767;
		//----------------------------------------------------------------------
		//タイルレクタングルを作る
		const rectangle	= this.tilingScheme.tileXYToRectangle( x, y, level );
		//----------------------------------------------------------------------
		//タイル幅（ラジアン換算）が設定値より大きい（距離が遠い）場合は空のterrainデータを返す
		if (
			Number.isFinite( this.zeroRectangleLimit )	//falseでないことの確認
			&& rectangle.width > Number( this.zeroRectangleLimit )
		) {
			// return this.emptyHeightmap( size );
			return this.emptyHeightmap();
		}
		//----------------------------------------------------------------------
		//法線ベクトルを使用しない場合はHeightmapTerrainDataのインスタンスを生成して返す
		if ( !this.hasVertexNormals ) {
			return new Cesium.HeightmapTerrainData({
				buffer: terrain,
				width: size,
				height: size,
			});
		}
		//----------------------------------------------------------------------
		//幾何学的誤差からスカート長を決める
		const error	= this.getLevelMaximumGeometricError( level );
		const skirtHeight	= error * 5;
		//----------------------------------------------------------------------
		//標高値の最小と最大を決める
		const minimumHeight	= Math.min.apply( this, Array.from( terrain ));
		const maximumHeight	= Math.max.apply( this, Array.from( terrain ));
		//----------------------------------------------------------------------
		//量子化用の係数を決める
		const factor	= quantizedMax / ( size - 1 );
		//----------------------------------------------------------------------
		//xyを格納する型付配列を用意
		const xValues	= new Uint16Array( size ** 2 );
		const yValues	= new Uint16Array( size ** 2 );
		//----------------------------------------------------------------------
		//xyをそれぞれ0から32767の範囲で量子化して格納
		for ( let i = 0; i < size; i ++ ) {
			xValues.set(
				new Uint16Array( size ).map(( value, index ) => index * factor ),
				i * size
			);
			yValues.set(
				new Uint16Array( size ).fill(( size - 1 - i ) * factor ),
				i * size
			);
		}
		//----------------------------------------------------------------------
		//標高値の最小と最大の差を決めて、terrainを量子化
		const subtraction	= maximumHeight - minimumHeight;
		const levelValues	= new Uint16Array(
			terrain.map(( value ) => {
				return ( value - minimumHeight ) / subtraction * quantizedMax
			})
		);
		//----------------------------------------------------------------------
		//xyと標高値の量子化結果用の変数を作って結果を格納
		const quantizedVertices	= new Uint16Array(
			xValues.length + yValues.length + levelValues.length
		);
		[ xValues, yValues, levelValues ].reduce(( acc, cur ) => {
			quantizedVertices.set( cur, acc );
			return acc + cur.length;
		}, 0 );
		//----------------------------------------------------------------------
		//タイルレクタングルからhorizonOcclusionPoint（水平線との咬合点）を求める
		const tileCenter	= Cesium.Cartographic.toCartesian(
			Cesium.Rectangle.center( rectangle )
		);
		const cosWidth	= Math.cos( rectangle.width / 2 );
		const occlusionHeight	= ( 1 + maximumHeight / R ) / cosWidth;
		const scaledCenter	= Cesium.Ellipsoid.WGS84.transformPositionToScaledSpace(
			tileCenter
		);
		const horizonOcclusionPoint	= new Cesium.Cartesian3(
			scaledCenter.x,
			scaledCenter.y,
			occlusionHeight
		);
		//----------------------------------------------------------------------
		//orientedBoundingBox、boundingSphereを決める
		const orientedBoundingBox	= rectangle.width < Cesium.Math.PI_OVER_TWO + Cesium.Math.EPSILON5
		? Cesium.OrientedBoundingBox.fromRectangle( rectangle, minimumHeight, maximumHeight )
		: void( 0 );
		const boundingSphere	= orientedBoundingBox === void( 0 )
		// ? new Cesium.BoundingSphere( Cesium.Cartesian3.ZERO, 6379792.481506292 )
		? new Cesium.BoundingSphere( Cesium.Cartesian3.ZERO, R )
		: Cesium.BoundingSphere.fromOrientedBoundingBox( orientedBoundingBox );
		//----------------------------------------------------------------------
		//頂点法線ベクトルを格納する変数を用意
		const encodedNormals = new Uint8Array( size ** 2 * 2 );
		//頂点を走査
		for ( let y = 0; y < size; y ++ ) {
			const lat	= rectangle.north * ( 1 - y / size ) + rectangle.south * y / size;
			const sinLat	= Math.sin( lat );
			const cosLat	= Math.cos( lat );
			const nz0		= R * 2 * Math.PI / Math.pow( 2, level ) / size * cosLat;
			for ( let x = 0; x < size; x ++ ) {
				const index	= y * size + x;
				const nx	= ( x === size - 1 )
				? terrain[ index - 1 ] - terrain[ index ]
				: terrain[ index ] - terrain[ index + 1 ];
				const ny	= ( y === size - 1 )
				? terrain[ index ] - terrain[ index - size ]
				: terrain[ index + size ] - terrain[ index ];
				//法線ベクトル（nx、ny、nz）の回転行列計算
				//第1回転：xを回転軸としてPI/2 - lat回転
				//第2回転：Z=zを回転軸としてlng回転
				const lng	= rectangle.west * ( 1 - x / size ) + rectangle.east * x / size;
				const sinLng	= Math.sin( lng );
				const cosLng	= Math.cos( lng );
				const rotate	= [
					 cosLng, sinLat * sinLng, -cosLat * sinLng,
					-sinLng, sinLat * cosLng, -cosLat * cosLng,
					 0,      cosLat,           sinLat
				];
				//法線ベクトル（nx、ny、nz）を回転する
				const normalZ	=                  ny * rotate[7] + nz0 * rotate[8];
				const normalX	= nx * rotate[0] + ny * rotate[1] + nz0 * rotate[2];
				const normalY	= nx * rotate[3] + ny * rotate[4] + nz0 * rotate[5];
				//oct encoding
				const w	= Math.abs( normalX ) + Math.abs( normalY ) + Math.abs ( normalZ );
				const octEncoded	= {
					octX	: normalX / w,
					octY	: normalY / w
				};
				const { octX, octY }	= octEncoded;
				if ( normalZ <= 0 ) {
					octEncoded.octX	= ( octX >= 0 ? 1 : -1 ) * ( 1 - Math.abs( octY ));
					octEncoded.octY	= ( octY >= 0 ? 1 : -1 ) * ( 1 - Math.abs( octX ));
				}
				//格納
				encodedNormals[ index * 2 ]	= ( octEncoded.octX + 1 ) * 127.5;
				encodedNormals[ index * 2 + 1 ]	= ( octEncoded.octY + 1 ) * 127.5;
			}
		}
		//----------------------------------------------------------------------
		//QuantizedMeshTerrainDataのインスタンスを生成して返す
		return new Cesium.QuantizedMeshTerrainData({
			minimumHeight,
			maximumHeight,
			quantizedVertices,
			indices: this.indices.all,
			boundingSphere,
			orientedBoundingBox,
			horizonOcclusionPoint,
			northIndices: this.indices.north,
			southIndices: this.indices.south,
			westIndices: this.indices.west,
			eastIndices: this.indices.east,
			northSkirtHeight: skirtHeight,
			southSkirtHeight: skirtHeight,
			westSkirtHeight: skirtHeight,
			eastSkirtHeight: skirtHeight,
			childTileMask: 15,
			encodedNormals
		});
	}

	//**************************************************************************
	//幾何学的誤差の推定値取得
	/*
		@param	number	: zoom level
	*/
	getLevelMaximumGeometricError ( level ) {
		return Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
			this.tilingScheme.ellipsoid,
			this.heightmapWidth,
			this.tilingScheme.getNumberOfXTilesAtLevel( 0 )
		) / ( 1 << level );
	}

	//**************************************************************************
	//タイルの有効性確認
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
	*/
	getTileDataAvailable ( x, y, level ) {
		//----------------------------------------------------------------------
		//シームレス標高タイルの場合
		//海陸両方を網羅するのはズームレベル9以下
		//陸を網羅するのはズームレベル14以下
		//地理院タイルの場合陸を網羅するのはズームレベル14以下（海はすべて無効値）
		return level <= this.maximumLevel;
	}

	//**************************************************************************
	//未使用メソッド（インターフェイスで定義）
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
	*/
	loadTileDataAvailability ( x, y, level ) {
		return void( 0 );
	}
};
