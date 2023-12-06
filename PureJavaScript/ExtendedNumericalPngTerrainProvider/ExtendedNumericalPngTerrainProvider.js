//**************************************************************************
//ExtendedNumericalPngTerrainProvider
//NumericalPngTerrainProvider拡張
//タイル欠損対応・無効値ピクセル対応・ジオイド高対応
//TerrainProvider extend NumericalPngTerrainProvider
//resolved lack of tiles, invalid pixels, geoid height
/*!
 *	@name	: ExtendedNumericalPngTerrainProvider
 *	@description	: Terrain provider for numerical png tile of elevation extended.
 *	@version	: 2.0.0
 *	@released	: 20231120
 *	@required	: Cesium, NumericalPngTerrainProvider
 *	@author	: Kaoru KITAO
 *	@email	: kaoru@kitao.net
 *      @copyright      : 2023, National Institute of Advanced Industrial Science and Technology (AIST)
 *      @license        : Apache License, Version 2.0
*/

//******************************************************************************
//ExtendedNumericalPngTerrainProviderクラス
class ExtendedNumericalPngTerrainProvider extends NumericalPngTerrainProvider {
	//**************************************************************************
	//追加のメンバ変数
	//--------------------------------------------------------------------------
	//ジオイド高タイルURLテンプレート
	geoidUrl;
	//--------------------------------------------------------------------------
	//ジオイド高を反映するか否か
	useGeoid;
	//--------------------------------------------------------------------------
	//ジオイド高のピクセル値をメートル単位に変換する係数
	geoidHeightScale;
	//--------------------------------------------------------------------------
	//探索ズームレベル設定（標高とジオイド高）
	//日本の陸域全部を保持する最大ズームレベル
	japanCoveredLevel;
	geoidJapanCoveredLevel;

	//**************************************************************************
	//コンストラクタ
	constructor ( opts ) {
		//----------------------------------------------------------------------
		//継承元コンストラクタの実行
		super( opts );
		//----------------------------------------------------------------------
		//追加オプションをメンバ変数に登録
		//ジオイド高タイルURLをテンプレートの指定
		this.geoidUrl	= Cesium.defaultValue(
			opts.geoidUrl,
			'https://tiles.gsj.jp/tiles/elev/gsigeoid/{z}/{y}/{x}.png'
		);
		//デフォルトはジオイド高を反映しない
		this.useGeoid	= Cesium.defaultValue( opts.useGeoid, false );
		//ジオイド高メートル換算係数
		this.geoidHeightScale	= Cesium.defaultValue(
			opts.geoidHeightScale,
			0.0001
		);
		//探索ズームレベル設定（標高）
		this.japanCoveredLevel	= Cesium.defaultValue(
			opts.japanCoveredLevel,
			14
		);
		//探索ズームレベル設定（ジオイド高）
		this.geoidJapanCoveredLevel	= Cesium.defaultValue(
			opts.geoidJapanCoveredLevel,
			8
		);
	}

	//**************************************************************************
	//既存メソッドの上書き（requestTileGeometryから呼ばれる）
	//標高タイルに加えてジオイド高タイルを加算する可能性があるためその過程を追加
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@return	mixed	: QuantizedMeshTerrainData or HeightmapTerrainData instance
	*/
	async createTileGeometry ( x, y, level ) {
		//----------------------------------------------------------------------
		//合成canvasを作る処理が標高とジオイド高で必要となるためプロミス配列を作る
		//標高処理は必須であるためデフォルトで追加
		const promises	= [
			this.createSynthesizedTileExtended( x, y, level, 'elevation' )
		];
		//ジオイド高処理はコンストラクタ引数で指定
		if ( this.useGeoid ) {
			//ジオイド高を加える場合はジオイド高処理を登録
			promises.push( this.createSynthesizedTileExtended( x, y, level, 'geoid' ));
		} else {
			//ジオイド高を加えない場合はfalseを返すプロミスを登録
			promises.push( Promise.resolve( false ));
		}
		//----------------------------------------------------------------------
		//2つのプロミス結果を待って処理
		return await Promise.all( promises ).then(
			( values ) => {
				//結果の状態で分岐
				if (
					!( values[0] instanceof HTMLCanvasElement )
					&& !( values[1] instanceof HTMLCanvasElement )
				) {
					//標高とジオイド高の両方とも取得できなかった場合は空のheightmapを返す
					return this.emptyHeightmap();
				} else if (
					values[0] instanceof HTMLCanvasElement
					&& values[1] instanceof HTMLCanvasElement
				) {
					//標高とジオイド高の両方とも取得できた場合
					const heightScales	= [
						this.heightScale,
						this.geoidHeightScale
					];
					//terrainを作る
					const terrain	= values.map(( value, index ) => {
						//それぞれで処理
						//imageDataを取得してバイリニア単位に応じて処理を振り分けて結果を返す
						const imageData	= value.getContext( '2d' ).getImageData(
							0, 0, value.width, value.height
						);
						return value.unitSize === 1
						? this.imageDataToTerrain( imageData, heightScales[ index ] )
						: this.imageDataToTerrainBilineard(
							imageData, heightScales[ index ], value.unitSize
						);
					}).reduce(( acc, cur ) => {
						//両方の結果を合算して返す
						return acc.map(( value, index ) => {
							return value + cur[index];
						});
					});
					//得られたterrainを量子化して返す
					return this.createQuantizedMeshData( x, y, level, terrain );
				} else if ( values[0] instanceof HTMLCanvasElement ) {
					//標高のみ取得できた場合
					//imageDataを取得してバイリニア単位に応じて分岐処理して結果を返す
					const imageData	= values[0].getContext( '2d' ).getImageData(
						0, 0, values[0].width, values[0].height
					);
					const terrain	= values[0].unitSize === 1
					? this.imageDataToTerrain( imageData, this.heightScale )
					: this.imageDataToTerrainBilineard(
						imageData, this.heightScale, values[0].unitSize
					);
					//得られたterrainを量子化して返す
					return this.createQuantizedMeshData( x, y, level, terrain );
				} else {
					//ジオイド高のみ取得できた場合
					//imageDataを取得してバイリニア単位に応じて分岐処理して結果を返す
					const imageData	= values[1].getContext( '2d' ).getImageData(
						0, 0, values[1].width, values[1].height
					);
					const terrain	= values[1].unitSize === 1
					? this.imageDataToTerrain( imageData, this.geoidHeightScale )
					: this.imageDataToTerrainBilineard(
						imageData, this.geoidHeightScale, values[1].unitSize
					);
					//得られたterrainを量子化して返す
					return this.createQuantizedMeshData( x, y, level, terrain );
				}
			}
		);
	}

	//**************************************************************************
	//既存メソッドの拡張（createTileGeometryから呼ばれる）
	//第3引数typeを追加し、標高とジオイド高で処理を分岐可能となるよう変更
	//主、右、下、右下の合成タイルを作る
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@param	string	: 'elevation' or 'geoid'
		@return	mixed	: canvas or false
	*/
	async createSynthesizedTileExtended ( x, y, level, type ) {
		//----------------------------------------------------------------------
		//タイルURLテンプレートと探索で使用するメソッドを決める
		const parameters	= type === 'elevation'
		? { url: this.url, method: 'seekElevationTile' }
		: type === 'geoid'
		? { url: this.geoidUrl, method: 'seekGeoidTile' }
		: false;
		//----------------------------------------------------------------------
		//実際にはfalseにならないのでこの処理は呼ばれない
		if ( parameters === false ) {
			throw new Error( 'Invalid type specified.' );
		}
		//----------------------------------------------------------------------
		//主、右、下、右下のタイルを取得するプロミス配列を作る
		const promises	= [
			[ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ 1, 1 ]
		].map(( values ) => {
			//ズームレベル0と右端タイルの場合を考慮して取得タイルのx座標を決める
			const tileX	= level === 0
			? 0
			: x + values[0] < 2 ** level
			? x + values[0]
			: 0;
			//タイル取得プロミスを返す（seekElevationTileまたはseekGeoidTile）
			return this[ parameters.method ](
				tileX, y + values[1], level, parameters.url
			);
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
					//主タイル（Canvas）取得成功時
					//canvasを作ってcontextを取得
					const canvas	= document.createElement( 'canvas' );
					canvas.width	= canvas.height	= this.tileWidth + 1;
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
					canvas.unitSize	= values[0].unitSize;
					//canvasを返す
					return canvas;
				} else {
					//主タイル取得失敗時
					//falseを返す
					return false;
				}
			}
		);
	}

	//**************************************************************************
	//標高タイルを探索する
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@return	mixed	: canvas or false
	*/
	async seekElevationTile ( x, y, level ) {
		//----------------------------------------------------------------------
		//結果を格納するcanvasを作ってcontextを取得
		const canvas	= document.createElement( 'canvas' );
		canvas.width	= canvas.height	= this.tileWidth;
		const context	= canvas.getContext( '2d' );
		//----------------------------------------------------------------------
		//タイルが取得できていないことを示すフラグを用意する
		canvas.retrieved	= false;
		//----------------------------------------------------------------------
		//取得対象ズームレベルの初期値（ここから1ずつ減らしていく）
		let seekLevel	= level;
		//----------------------------------------------------------------------
		//タイルが取得できていない場合はループ
		while ( canvas.retrieved === false ) {
			//取得すべきタイル座標を決めてタイルを取得する
			const seekedCoords	= this.getSeekTileCoords( seekLevel, x, y, level );
			const tile	= await this.fetchTile(
				seekedCoords.x,
				seekedCoords.y,
				seekedCoords.level,
				this.url
			);
			//取得できた場合のみ処理
			if ( tile instanceof HTMLImageElement ) {
				//元のズームレベルと取得したタイルのズームレベルで分岐
				if ( seekLevel === level ) {
					//元のズームレベルでタイルを取得できた場合はそのまま貼り付け
					context.drawImage( tile, 0, 0 );
				} else {
					//低ズームレベルを取得した場合
					//切り出す原点とサイズを決める
					const origin	= this.getCropOrigin(
						seekLevel, x, y, level
					);
					const cropSize	= Math.max(
						1, this.tileWidth / ( 2 ** ( level - seekLevel ))
					);
					//切り出す
					const cropped	= this.cropTile( tile, origin, cropSize );
					//canvasを埋める
					this.fillFlat( context, cropped );
				}
				//タイル取得完了のフラグを立てる
				canvas.retrieved	= true;
				//バイリニア単位をセット（この値+1のサイズでバイリニアする）
				canvas.unitSize	= Math.min(
					this.tileWidth, 2 ** ( level - seekLevel )
				);
			}
			//次の探索ズームレベルを決める
			seekLevel	-= 1;
			//ズームレベルが既定値未満の場合は処理終了
			if ( seekLevel < this.japanCoveredLevel ) {
				break;
			}
		}
		//----------------------------------------------------------------------
		//結果を返す
		return canvas.retrieved ? canvas : false;
	}

	//**************************************************************************
	//ジオイド高タイルを探索する
	/*
		@param	number	: x coordinate for tile
		@param	number	: y coordinate for tile
		@param	number	: zoom level for tile
		@return	mixed	: canvas or false
	*/
	async seekGeoidTile ( x, y, level ) {
		//----------------------------------------------------------------------
		//結果を格納するcanvasを作ってcontextを取得
		const canvas	= document.createElement( 'canvas' );
		canvas.width	= canvas.height	= this.tileWidth;
		const context	= canvas.getContext( '2d' );
		//----------------------------------------------------------------------
		//取得対象ズームレベルの初期値（探索は1回のみ）
		let seekLevel	= Math.min( level, this.geoidJapanCoveredLevel );
		//----------------------------------------------------------------------
		//取得すべきタイル座標を決めてタイルを取得する
		const seekedCoords	= this.getSeekTileCoords( seekLevel, x, y, level );
		const tile	= await this.fetchTile(
			seekedCoords.x,
			seekedCoords.y,
			seekedCoords.level,
			this.geoidUrl
		);
		//----------------------------------------------------------------------
		//取得できた場合のみ処理
		if ( tile instanceof HTMLImageElement ) {
			//元のズームレベルと取得したタイルのズームレベルで分岐
			if ( seekLevel === level ) {
				//元のズームレベルでタイルを取得できた場合はそのまま貼り付け
				context.drawImage( tile, 0, 0 );
			} else {
				//低ズームレベルを取得した場合
				//切り出す原点とサイズを決める
				const origin	= this.getCropOrigin( seekLevel, x, y, level );
				const cropSize	= Math.max(
					1, this.tileWidth / ( 2 ** ( level - seekLevel ))
				);
				//切り出す
				const cropped	= this.cropTile( tile, origin, cropSize );
				//canvasを埋める
				this.fillFlat( context, cropped );
			}
			//バイリニア単位をセット（この値+1のサイズでバイリニアする）
			canvas.unitSize	= Math.min(
				this.tileWidth, 2 ** ( level - seekLevel )
			);
			//canvasを返す
			return canvas;
		} else {
			//falseを返す
			return false;
		}
	}

	//**************************************************************************
	//切り出すタイルのタイル座標を決める
	/*
		@param	number	: level coordinate for actual retrieving tile
		@param	number	: x coordinate for originally tile
		@param	number	: y coordinate for originally tile
		@param	number	: level coordinate for originally tile
		@return	object	: x, y, level coordinates
	*/
	getSeekTileCoords ( seekTileLevel, x, y, level ) {
		const unitSize	= 2 ** ( level - seekTileLevel );
		const seekTileX	= Math.floor( x / unitSize );
		const seekTileY	= Math.floor( y / unitSize );
		return { x: seekTileX, y: seekTileY, level: seekTileLevel };
	}

	//**************************************************************************
	//タイルからの切り出し位置（原点）を決める
	/*
		@param	number	: level coordinate for actual retrieving tile
		@param	number	: x coordinate for originally tile
		@param	number	: y coordinate for originally tile
		@param	number	: level coordinate for originally tile
		@return	object	: x, y coordinates
	*/
	getCropOrigin ( seekTileLevel, x, y, level ) {
		const point	= {
			x: x * this.tileWidth,
			y: y * this.tileWidth
		};
		return {
			x: Math.floor( point.x / 2 ** ( level - seekTileLevel ) % this.tileWidth ),
			y: Math.floor( point.y / 2 ** ( level - seekTileLevel ) % this.tileWidth )
		};
	}

	//**************************************************************************
	//原点と大きさを指定して必要箇所を切り出す
	/*
		@param	element	: image
		@param	object	: origin to crop
		@param	number	: size to crop
		@return	element	: canvas
	*/
	cropTile ( tile, origin, size ) {
		const canvas	= document.createElement( 'canvas' );
		canvas.width	= canvas.height	= size;
		const context	= canvas.getContext( '2d' );
		context.drawImage(
			tile, origin.x, origin.y, size, size, 0, 0, size, size
		);
		return canvas;
	}

	//**************************************************************************
	//フラット補間（ピクセル単純拡大）
	//標高タイルは隣接タイルが同じズームレベルとは限らないため一旦これを使う必要あり
	/*
		@param	context	: to fill
		@param	canvas	: source for filling
	*/
	fillFlat ( context, cropped ) {
		const size	= context.canvas.width / cropped.width;
		const imageData	= cropped.getContext( '2d' ).getImageData(
			0, 0, cropped.width, cropped.height
		);
		for ( let y = 0; y < cropped.height; y += 1 ) {
			for ( let x = 0; x < cropped.width; x += 1 ) {
				const index	= y * cropped.width + x;
				const rgba	= imageData.data.slice( index * 4, index * 4 + 4 );
				context.fillStyle	= `rgba(${rgba.toString()})`;
				context.fillRect( x * size, y * size, size, size );
			}
		}
	}

	//**************************************************************************
	//imageDataを間引いてバイリニア補間しつつterrainに変換する
	/*
		@param	object	: imageData
		@param	number	: source expanded size
		@return	typed	: optimized terrain data
	*/
	imageDataToTerrainBilineard ( imageData, scale, srcInterval ) {
		//----------------------------------------------------------------------
		//間引き間隔
		const dstInterval	= this.tileWidth / ( this.heightmapWidth - 1 );
		//----------------------------------------------------------------------
		//バイリニアで使用しうる標高（四隅）を最初に求めておく
		const elevations	= new Float32Array(( this.tileWidth + 1 ) ** 2 );
		for ( let y = 0, maxY = this.tileWidth + 1; y < maxY; y += srcInterval ) {
			for ( let x = 0, maxX = this.tileWidth + 1; x < maxX; x += srcInterval ) {
				const index	= y * ( this.tileWidth + 1 ) + x;
				const rgba	= imageData.data.slice( index * 4, index * 4 + 4 );
				elevations[ index ]	= this.rgbaToHeight( rgba, scale );
			}
		}
		// //----------------------------------------------------------------------
		// //terrainを決める
		// const terrain	= [];
		// for ( let y = 0, maxY = this.tileWidth + 1; y < maxY; y += dstInterval ) {
		// 	//バイリニアの上座標と下座標とyの100分率
		// 	const t	= Math.floor( y / srcInterval ) * srcInterval;
		// 	const b	= Math.min( t + srcInterval, this.tileWidth );
		// 	const dy	= b - t === 0 ? 0 : ( y - t ) / ( b - t );
		// 	for ( let x = 0, maxX = this.tileWidth + 1; x < maxX; x += dstInterval ) {
		// 		//バイリニアの左座標と右座標とxの100分率
		// 		const l	= Math.floor( x / srcInterval ) * srcInterval;
		// 		const r	= Math.min( l + srcInterval, this.tileWidth );
		// 		const dx	= r - l === 0 ? 0 : ( x - l ) / ( r - l );
		// 		//四隅の標高を求める
		// 		const lt	= elevations[ t * ( this.tileWidth + 1 ) + l ];
		// 		const rt	= elevations[ t * ( this.tileWidth + 1 ) + r ];
		// 		const lb	= elevations[ b * ( this.tileWidth + 1 ) + l ];
		// 		const rb	= elevations[ b * ( this.tileWidth + 1 ) + r ];
		// 		//バイリニア補完した結果を格納する
		// 		terrain.push(
		// 			(
		// 				( 1 - dx ) * ( 1 - dy ) * lt
		// 			) + (
		// 				dx * ( 1 - dy ) * rt
		// 			) + (
		// 				( 1 - dx ) * dy * lb
		// 			) + (
		// 				dx * dy * rb
		// 			)
		// 		);
		// 	}
		// }
		//----------------------------------------------------------------------
		//terrainを決める
		const terrain	= new Float32Array( this.heightmapWidth ** 2 );
		// for ( let y = 0, maxY = ( this.tileWidth + 1 ) / dstInterval; y < maxY; y += 1 ) {
		for ( let y = 0; y < this.heightmapWidth; y += 1 ) {
			//バイリニアの上座標と下座標とyの100分率
			const t	= Math.floor( y * dstInterval / srcInterval ) * srcInterval;
			const b	= Math.min( t + srcInterval, this.tileWidth );
			const dy	= b - t === 0 ? 0 : ( y * dstInterval - t ) / ( b - t );
			// for ( let x = 0, maxX = ( this.tileWidth + 1 ) / dstInterval; x < maxX; x += 1 ) {
			for ( let x = 0; x < this.heightmapWidth; x += 1 ) {
				//バイリニアの左座標と右座標とxの100分率
				const l	= Math.floor( x * dstInterval / srcInterval ) * srcInterval;
				const r	= Math.min( l + srcInterval, this.tileWidth );
				const dx	= r - l === 0 ? 0 : ( x * dstInterval - l ) / ( r - l );
				//四隅の標高を求める
				const lt	= elevations[ t * ( this.tileWidth + 1 ) + l ];
				const rt	= elevations[ t * ( this.tileWidth + 1 ) + r ];
				const lb	= elevations[ b * ( this.tileWidth + 1 ) + l ];
				const rb	= elevations[ b * ( this.tileWidth + 1 ) + r ];
				//バイリニア補完した結果を格納する
				terrain[ y * this.heightmapWidth + x ]	= (
					( 1 - dx ) * ( 1 - dy ) * lt
				) + (
					dx * ( 1 - dy ) * rt
				) + (
					( 1 - dx ) * dy * lb
				) + (
					dx * dy * rb
				);
			}
		}
		//----------------------------------------------------------------------
		//結果を返す
		return terrain;
	}
}
