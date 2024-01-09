# NumericalPngTerrainProvider & ExtendedNumericalPngTerrainProvider

## 概要

NumericalPngTerrainProvider および ExtendedNumericalPngTerrainProvider (以後、本プログラムと呼称します) は、国立研究開発法人 産業技術総合研究所 地質情報研究部門 シームレス地質情報研究グループが運用する [標高タイルサービス](https://tiles.gsj.jp/tiles/elev/tiles.html) の各種データを、オープンソースの三次元地理空間可視化プラットフォームである [CesiumJS](https://www.cesium.com/platform/cesiumjs/) の地形表現 (Terrain (Digtal Elevation Model)) のデータソースとして利用可能とするものです。

## 構成

本プログラムは、標高タイルサービスのデータである標高数値 PNG タイルを、CesiumJS のデータとして利用可能とするための 2 種類のクラスを提供します。
動作確認は CesiumJS version 1.110 で実施しています。

それぞれの概要を以下に記します。

1. NumericalPngTerrainProvider

   標高数値 PNG タイルを利用するための基本となるクラスです。

1. ExtendedNumericalPngTerrainProvider

   NumericalPngTerrainProvider を拡張したクラスです。
   以下の 2 つの機能を提供します。

   - 低ズームレベル探索機能

     指定した最大ズームレベル（デフォルト値14）のタイルが存在しないときにより低ズームレベルのタイルを探索し見つかったタイルを拡大して使用します。
     これにより違和感なく三次元地形表現を実現することが可能です。
     また、設定により探索方法変更することが可能です。

   - ジオイド高反映機能

     CesiumJS は地球を回転楕円体とみなして描画します。
     回転楕円体上で地形をより正確に表現するには標高に加えてジオイド高を加味する必要があります。
     本機能は標高にジオイド高を加えて三次元で地形を表現する機能を提供します。

   **注意: NumericalPngTerrainProvider を拡張したクラスであるため、使用時には NumericalPngTerrainProvider も併せて読み込む必要があります。**

NumericalPngTerrainProvider は [Node.js](https://nodejs.org/) 向けと Pure JavaScript 向け、ExtendedNumericalPngTerrainProvider は Pure JavaScript 向けのみを、それぞれ用意しています。

Node.js 向けは `NodeProject` ディレクトリ以下に、Pure JavaScript 向けは `PureJavaScript` ディレクトリ以下に、それぞれ収めています。

Node.js 向けは、以下の手順でファイルのインストール・モジュールバンドルが可能です。

```
$ cd <本プログラムのトップディレクトリ>/NodeProject/NumericalPngTerrainProvider
$ npm install
$ npm run build
```

Pure JavaScript 向けは、Web サーバから参照可能なパスに本プログラムを配置し、HTML ファイルに以下の記述をします。

```
<script src="<本プログラムを配置したパス>/NumericalPngTerrainProvider.js"></script>
<script src="<本プログラムを配置したパス>/ExtendedNumericalPngTerrainProvider.js"></script>
```

## 使用方法

NumericalPngTerrainProvider もしくは ExtendedNumericalPngTerrainProvider のインスタンスを生成し、生成したインスタンスを CesiumJS の `Cesium.Viewer クラス` のインスタンス生成時のオプションとして指定することで使用することができます。

以下に使用例を記します。

- [統合 DEM](https://tiles.gsj.jp/tiles/elev/tiles.html) を地形表現として使用する。

  ```
  const viewer = new Cesium.Viewer( 'app', {
      terrainProvider: new NumericalPngTerrainProvider()
  });
  ```

- 国土地理院の [基盤地図情報数値標高モデル (DEM10B)](https://tiles.gsj.jp/tiles/elev/tiles.html) を地形表現として使用し、著作権情報に国土地理院の情報を指定する。

  ```
  const viewer = new Cesium.Viewer( 'app', {
      terrainProvider: new NumericalPngTerrainProvider({
          'url' : 'https://tiles.gsj.jp/tiles/elev/gsidem/{z}/{y}/{x}.png',
          'credit' : new Cesium.Credit('<b>AUTHORITY:&nbsp;</b><a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院タイル (Tiles of Geospatial Information Authority of Japan)</a></p>'
      })
  });
  ```

いずれのクラスもデフォルトの設定を使用した場合、統合 DEM を使用する設定となっています。

設定を変更する場合は、先の使用例にも記載した通り、インスタンス生成時に引数を与えることで変更が可能です。

以下に使用可能な引数を記します。

### 使用可能な引数

- 引数はオブジェクトとして与えます。

- 引数の属性は全て「任意」となります。「必須」の引数はありません。

| 名前 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| url | string | `https://tiles.gsj.jp/tiles/elev/mixed/{z}/{y}/{x}.png` | 標高数値 PNG タイルのタイル URL テンプレートを指定します。 |
| credit | Cesium.Credit \| string | `<a href="https://gbank.gsj.jp/seamless/elev/">Seamless Elevation Tiles</a>` | 標高数値 PNG タイルの著作者情報を指定します。|
| maximumLevel | number | 14 | 指定した標高数値 PNG タイルで使用可能な最大ズームレベルを指定します。|
| ellipsoid | Cesium.Ellipsoid | Cesium.Ellipsoid.WGS84 | 地球楕円体の形状を指定します。|
| tileWidth | number | 256 | 指定した標高数値 PNG タイルのピクセルサイズを指定します。|
| heightScale | number | 0.01 | 標高数値 PNG タイルから得られるピクセル毎の値をメートルに換算するために乗じる係数を指定します。|
| heightInvalidValue | number | -8388608 (RGB: 128, 0, 0) | 標高数値 PNG タイルから得られるピクセル毎の値で無効値と判断する値を指定します。無効値は標高 0 メートルに変換して使用されます。|
| useVertexNormals | boolean | false | 法線ベクトルを使用するか否かを指定します。法線ベクトルを使用すると、CesiumJS のタイムライン使用時に太陽の位置に対して適切に影を表現します。**法線ベクトルの計算は処理負荷が高いため使用には注意が必要です。**|
| useGeoid | boolean | false | **ExtendedNumericalPngTerrainProvider 専用の引数です。** ジオイド高を地形表現に反映するか否かを指定します。|
| geoidUrl | string | https://tiles.gsj.jp/tiles/elev/gsigeoid/{z}/{y}/{x}.png | **ExtendedNumericalPngTerrainProvider 専用の引数です。** ジオイド高数値 PNG タイルのタイル URL テンプレートを指定します。|
| geoidHeightScale | number | 0.0001 | **ExtendedNumericalPngTerrainProvider 専用の引数です。** ジオイド高数値 PNG タイルから得られるピクセル毎の値をメートルに換算するために乗じる係数を指定します。|
| japanCoveredLevel | number | 14 | **ExtendedNumericalPngTerrainProvider 専用の引数です。** 日本の陸域すべてをカバーする標高数値 PNG タイルの最大ズームレベルを指定します。|
| geoidJapanCoveredLevel | number | 8 | **ExtendedNumericalPngTerrainProvider 専用の引数です。** 日本の陸域すべてをカバーするジオイド高数値PNGタイルの最大ズームレベルを指定します。|

以下の引数は変更可能としていますが、通常は変更する必要はありません。

**変更する場合には注意が必要です。**

| 名前 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| heightmapWidth | number | 65 | 元の標高数値 PNG タイルから間引いて、実際に使用するために作成する標高タイルデータのピクセルサイズを指定します。「2 のべき乗 +1」での指定を推奨します。|
| zeroRectangleLimit | nmber \| boolean | false | 使用する標高数値 PNG タイルを地球上に貼り付けた際の、そのサイズに対する地球中心からの角度（ラジアン）で指定します。ここで指定された値より大きい（より低ズームレベルの標高数値を使用する）場合に標高数値 PNG タイルを使用せずに（標高 0 メートルの扱いで）描画します。false 指定でこの値を未使用（すべての描画で標高数値 PNG タイルを適用）にすることが出来ます。|
| cacheSize | number | 100 | 取得した標高数値 PNG タイルをキャッシュする数量（上限値）を指定します。ここで指定した値を目安としてキャッシュの破棄を実行します。 ただしキャッシュの破棄は毎回実行されるわけではないため、ここで指定した数量を超えるキャッシュを保持する場合があります。|

## ライセンス

Copyright 2023, National Institute of Advanced Industrial Science and Technology (AIST).

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.

You may obtain a copy of the License at [http:\/\/www.apache.org\/licenses\/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and limitations under the License.

<!--
    @file README.md
    @copyright Copyright 2023 National Institute of Advanced Industrial
               Science and Technology (AIST)
-->
