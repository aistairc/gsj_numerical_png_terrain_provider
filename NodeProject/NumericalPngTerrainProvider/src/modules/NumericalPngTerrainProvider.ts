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
 *	@copyright	: 2023, National Institute of Advanced Industrial Science and Technology (AIST)
 *	@license	: Apache License, Version 2.0
*/

import {
	Cartographic,
	Rectangle,
	Ellipsoid,
	WebMercatorTilingScheme,
	TerrainProvider,
	Math as CMath,
	Event as CEvent,
	Cartesian3,
	BoundingSphere,
	QuantizedMeshTerrainData,
	HeightmapTerrainData,
	OrientedBoundingBox,
	Credit,
	TileAvailability,
} from '@cesium/engine';

//******************************************************************************
//cache element interface
interface TileCacheElement {
	x: number,
	y: number,
	level: number,
	value: object,
};

//******************************************************************************
//タイルシステムのキャッシングシステム
//TileCacherクラス
//配列ベースのFIFOキャッシュ（挿入順）。要素数は最大でも数百件程度（cacheSize）であり、
//文字列キーを作ってMapでハッシュ探索するより、単純な数値比較の線形探索の方が
//実測で高速だったため（文字列生成・ハッシュ計算のコストが線形探索を上回る）、
//あえて配列＋線形探索を採用している。
//add()はキャッシュミス時にしか呼ばれないため、get()で「最終アクセス順」まで
//厳密に並び替える必要性は薄い。get()での並び替え（splice+push）は、同一キーへの
//連続アクセスのたびに末尾へ再配置→次回また末尾までの走査が必要、という自己矛盾した
//コストを生むため、あえて行わない（get()は読み取り専用・不変）。
//そのため上限超過時の破棄は「最終アクセスが古い順」ではなく「挿入が古い順」になる。
//値のディープコピーは行わない（呼び出し側で必要な場合は呼び出し側で複製する）ため、
//キャッシュする値は再利用しても問題のない軽量なデータ（terrain配列など）を想定する。
class TileCacher {
	//**************************************************************************
	//メンバ変数
	caches: Array < TileCacheElement > = [];	//キャッシュ格納（先頭が最古、末尾が最新）
	size: number;	//キャッシュ上限数

	//**************************************************************************
	//コンストラクタ
	/*
		@param	number	: count for tiles to cache
	*/
	constructor ( size?: number ) {
		//----------------------------------------------------------------------
		//キャッシュを格納する配列の初期化とキャッシュの上限を設定
		this.size	= size ?? 256;
	}

	//**************************************************************************
	//タイル座標が合致する要素のインデックスを探す
	/*
		@param	number	: x coordinate of tile
		@param	number	: y coordinate of tile
		@param	number	: level coordinate of tile
		@return	number	: 見つかったインデックス（見つからなければ-1）
	*/
	indexOf (
		x: number,
		y: number,
		level: number
	): number {
		return this.caches.findIndex(( element ) => {
			return element.x === x && element.y === y && element.level === level;
		});
	}

	//**************************************************************************
	//タイル座標を指定してキャッシュを取得
	/*
		@param	number	: x coordinate of tile
		@param	number	: y coordinate of tile
		@param	number	: level coordinate of tile
		@return	mixed	: object or undefined
	*/
	get (
		x: number,
		y: number,
		level: number
	) {
		//----------------------------------------------------------------------
		//該当要素のインデックスを探す
		const index	= this.indexOf( x, y, level );
		//----------------------------------------------------------------------
		//該当がなければundefinedを返す。あれば値をそのまま返す（複製・並び替えはしない）
		return index === -1 ? void( 0 ) : this.caches[ index ].value;
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
	add (
		x: number,
		y: number,
		level: number,
		value: object
	) {
		//----------------------------------------------------------------------
		//既存要素があれば挿入順をリセットするため一旦取り除く
		const index	= this.indexOf( x, y, level );
		if ( index !== -1 ) {
			this.caches.splice( index, 1 );
		}
		//----------------------------------------------------------------------
		//末尾（最新）に登録する
		this.caches.push({ x, y, level, value });
		//----------------------------------------------------------------------
		//上限を超えた分は先頭（最古）から破棄する
		if ( this.caches.length > this.size ) {
			this.caches.shift();
		}
		//----------------------------------------------------------------------
		//参照を返す
		return this;
	}
};

//******************************************************************************
//constructor options interface
interface NumericalPngTerrainProviderOpts {
	//--------------------------------------------------------------------------
	//general options
	url?: string,
	credit?: string | Credit,
	ellipsoid?: Ellipsoid,
	tileWidth?: number,
	heightScale?: number,
	maximumLevel?: number,
	heightInvalidValue?: number,
	useVertexNormals?: boolean,
	//--------------------------------------------------------------------------
	//special options, no need to define commonly
	heightmapWidth?: number,
	zeroRectangleLimit?: number | boolean,
	cacheSize?: number,
}

//******************************************************************************
//indices interface
interface NumericalPngTerrainProviderIndices {
	all: Uint16Array,
	north: number[],
	south: number[],
	west: number[],
	east: number[],
}

//******************************************************************************
//NumericalPngTerrainProviderクラス
export class NumericalPngTerrainProvider {
	//**************************************************************************
	//メンバ変数
	//--------------------------------------------------------------------------
	//初期値固定
	hasWaterMask		= false;
	ready				= true;
	readyPromise		= Promise.resolve( true );
	//--------------------------------------------------------------------------
	//コンストラクタで設定（初期値あり）
	url: string;
	credit: Credit;
	maximumLevel: number;
	ellipsoid: Ellipsoid;
	tileWidth: number;
	heightScale: number;
	heightInvalidValue: number;
	hasVertexNormals: boolean;
	heightmapWidth: number;
	zeroRectangleLimit: number | boolean;
	//--------------------------------------------------------------------------
	//コンストラクタで生成
	tilingScheme: WebMercatorTilingScheme;
	availability: TileAvailability;
	errorEvent: CEvent;
	indices: NumericalPngTerrainProviderIndices;
	//--------------------------------------------------------------------------
	//コンストラクタで生成（キャッシュ）
	cacheObj: TileCacher;

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
	constructor ( options: NumericalPngTerrainProviderOpts ) {
		//----------------------------------------------------------------------
		//引数の整理
		const opts	= options ?? {};
		//----------------------------------------------------------------------
		//メンバ変数初期値設定
		this.url	=
			// opts.url ?? 'https://tiles.gsj.jp/tiles/elev/mixed/{z}/{y}/{x}.png';
			opts.url ?? 'https://tiles.gsj.jp/tiles/elev/land/{z}/{y}/{x}.png';
		this.credit	= typeof opts.credit === 'string'
		? new Credit( opts.credit )
		: opts.credit instanceof Credit
		? opts.credit
		: new Credit([
			'<a href="https://gbank.gsj.jp/seamless/elev/">',
			'Seamless Elevation Tiles',
			'</a>'
		].join( '' ));
		this.ellipsoid		= opts.ellipsoid ?? Ellipsoid.WGS84;
		this.tileWidth		= opts.tileWidth ?? 256;
		this.heightScale	= opts.heightScale ?? 0.01;
		this.maximumLevel	= opts.maximumLevel ?? 14;
		this.heightInvalidValue	= opts.heightInvalidValue === void( 0 )
		? -8388608
		: opts.heightInvalidValue === null
		? 0
		: opts.heightInvalidValue;
		this.hasVertexNormals	= opts.useVertexNormals ?? false;
		this.heightmapWidth	= opts.heightmapWidth ?? 65;
		// this.zeroRectangleLimit	= opts.zeroRectangleLimit ?? (Math.PI / 180 * 0.5);
		this.zeroRectangleLimit	= opts.zeroRectangleLimit ?? false;
		const cacheSize		= opts.cacheSize ?? 100;
		//----------------------------------------------------------------------
		//標高マップの頂点インデックスを16ビットに抑える
		if ( this.heightmapWidth > 256 ) {
			throw new Error( '"heightmapWidth" must be equal or less than 256.' );
		}
		//----------------------------------------------------------------------
		//メンバ変数インスタンス生成（初期値設定後に決まる）
		this.tilingScheme	= new WebMercatorTilingScheme({
			numberOfLevelZeroTilesX: 1,
			numberOfLevelZeroTilesY: 1,
			ellipsoid: this.ellipsoid,
		});
		this.availability	= new TileAvailability(
			this.tilingScheme,
			this.maximumLevel
		);
		this.errorEvent	= new CEvent();
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
	createIndices ( heightmapWidth: number ): NumericalPngTerrainProviderIndices {
		//----------------------------------------------------------------------
		//結果を格納するオブジェクトを用意
		const indices: NumericalPngTerrainProviderIndices	= {
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
	//キャッシュにはterrain配列（軽量）のみを保持し、量子化・法線計算は毎回やり直す。
	//これはCesium側でTerrainDataのバッファがワーカーへ転送（detach）される可能性があり、
	//生成済みインスタンスをそのまま使い回すのは安全でないための設計。
	//取得に失敗した場合は空データ（長さ0のterrain配列）としてキャッシュし、再取得を防ぐ。
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@return	mixed	: QuantizedMeshTerrainData or HeightmapTerrainData instance
	*/
	async requestTileGeometry (
		x: number,
		y: number,
		level: number
	): Promise < object > {
		//----------------------------------------------------------------------
		//キャッシュを探す
		const cachedTerrain	= this.cacheObj.get( x, y, level ) as Float32Array | undefined;
		//----------------------------------------------------------------------
		//キャッシュの有無で分岐
		if ( cachedTerrain !== void( 0 )) {
			//キャッシュがあれば（複製した上で）量子化して返す
			return cachedTerrain.length === 0
			? this.emptyHeightmap()
			: this.createQuantizedMeshData( x, y, level, cachedTerrain.slice());
		} else {
			//キャッシュがなければterrainを作ってキャッシュし、量子化した結果を返す
			const terrain	= await this.createTerrain( x, y, level );
			this.cacheObj.add( x, y, level, terrain ?? new Float32Array( 0 ));
			return terrain === void( 0 )
			? this.emptyHeightmap()
			: this.createQuantizedMeshData( x, y, level, terrain );
		}
	}

	//**************************************************************************
	//標高terrain配列を作る
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@return	mixed	: terrain配列 または取得失敗時はundefined
	*/
	async createTerrain (
		x: number,
		y: number,
		level: number
	): Promise < Float32Array | undefined > {
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
				//取得成功時はterrainを作って返す
				return this.imageDataToTerrain(
					context.getImageData( 0, 0, tile.width, tile.height ),
					this.heightScale
				);
			}
		}
		//----------------------------------------------------------------------
		//取得失敗時はundefinedを返す
		return void( 0 );
	}

	//**************************************************************************
	//主、右、下、右下の合成タイルを作る
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@return	mixed	: canvas or false
	*/
	async createSynthesizedTile (
		x: number,
		y: number,
		level: number
	): Promise < HTMLCanvasElement | boolean > {
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
	fetchTile (
		x: number,
		y: number,
		level: number,
		url: string
	) {
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
	emptyHeightmap (): HeightmapTerrainData {
		//----------------------------------------------------------------------
		//インスタンスを生成して返す
		return new HeightmapTerrainData({
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
	imageDataToTerrain (
		imageData: ImageData,
		scale: number
	): Float32Array {
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
				//terrainに標高値をセット（配列を複製せず直接インデックス参照する）
				terrain[ y * this.heightmapWidth + x ]	= this.rgbaToHeight(
					imageData.data, index, scale
				);
			}
		}
		//----------------------------------------------------------------------
		//結果を返す
		return terrain;
	}

	//**************************************************************************
	//rgbaデータから標高を求める
	/*
		@param	typed	: rgba配列の元データ
		@param	number	: 参照するインデックス（このインデックスにr、+1にg、+2にb、+3にaがある）
		@param	number	: heightScale
		@return	number	: elevation
	*/
	rgbaToHeight (
		data: Uint8ClampedArray,
		index: number,
		scale: number
	): number {
		//----------------------------------------------------------------------
		//符号付きでピクセル値を計算
		const r	= data[ index ];
		const value	= r * 65536 + data[ index + 1 ] * 256 + data[ index + 2 ] - (
			r < 128 ? 0 : 16777216
		);
		//----------------------------------------------------------------------
		//無効値を0にして、スケールを乗じて返す
		return (
			data[ index + 3 ] === 0 || value === this.heightInvalidValue ? 0 : value
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
	createQuantizedMeshData (
		x: number,
		y: number,
		level: number,
		terrain: Float32Array
	) {
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
			return new HeightmapTerrainData({
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
		//標高値の最小と最大を決める（1パスで走査：大きい配列でのスタックオーバーフロー回避）
		let minimumHeight	= Infinity;
		let maximumHeight	= -Infinity;
		for ( let i = 0; i < terrain.length; i ++ ) {
			const value	= terrain[ i ];
			if ( value < minimumHeight ) minimumHeight	= value;
			if ( value > maximumHeight ) maximumHeight	= value;
		}
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
		const tileCenter	= Cartographic.toCartesian(
			Rectangle.center( rectangle )
		);
		const cosWidth	= Math.cos( rectangle.width / 2 );
		const occlusionHeight	= ( 1 + maximumHeight / R ) / cosWidth;
		const scaledCenter	= Ellipsoid.WGS84.transformPositionToScaledSpace(
			tileCenter
		);
		const horizonOcclusionPoint	= new Cartesian3(
			scaledCenter.x,
			scaledCenter.y,
			occlusionHeight
		);
		//----------------------------------------------------------------------
		//orientedBoundingBox、boundingSphereを決める
		const orientedBoundingBox	= rectangle.width < CMath.PI_OVER_TWO + CMath.EPSILON5
		? OrientedBoundingBox.fromRectangle( rectangle, minimumHeight, maximumHeight )
		: void( 0 );
		const boundingSphere	= orientedBoundingBox === void( 0 )
		// ? new Cesium.BoundingSphere( Cesium.Cartesian3.ZERO, 6379792.481506292 )
		? new BoundingSphere( Cartesian3.ZERO, R )
		: BoundingSphere.fromOrientedBoundingBox( orientedBoundingBox );
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
		return new QuantizedMeshTerrainData({
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
	getLevelMaximumGeometricError (
		level: number
	): number {
		return TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
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
	getTileDataAvailable (
		x: number,
		y: number,
		level: number,
	): boolean {
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
	loadTileDataAvailability (
		x: number,
		y: number,
		level: number,
	): undefined | Promise < void > {
		return void( 0 );
	}
};
