const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, argv) => {
  const isDev = argv.mode !== 'production';

  return {
    mode: argv.mode || 'development',
    entry: './src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isDev ? '[name].js' : '[name].[contenthash:8].js',
      publicPath: '/',
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.mjs', '.cjs', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: 'ts-loader',
            options: { onlyCompileBundledFiles: true },
          },
          exclude: /node_modules/,
        },
        {
          // WebAV 1.2.8 的发布包包含私有字段、可选链等现代语法。
          // Webpack 4 的解析器无法直接处理，因此只转译 WebAV 及其直接运行依赖。
          test: /\.(mjs|cjs|js)$/,
          include: [
            path.resolve(__dirname, 'node_modules', '@webav'),
            path.resolve(__dirname, 'node_modules', 'opfs-tools'),
            path.resolve(__dirname, 'node_modules', 'wave-resampler'),
          ],
          use: {
            loader: 'babel-loader',
            options: {
              sourceType: 'unambiguous',
              presets: [
                [
                  '@babel/preset-env',
                  {
                    targets: { chrome: '69' },
                    modules: false,
                    bugfixes: true,
                  },
                ],
              ],
            },
          },
        },
        {
          test: /\.mjs$/,
          include: /node_modules/,
          type: 'javascript/auto',
        },
        {
          test: /\.css$/,
          use: [
            isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
            'css-loader',
          ],
        },
        {
          test: /\.(png|jpe?g|gif|svg|webp|ico)(\?.*)?$/,
          use: [
            {
              loader: 'url-loader',
              options: {
                limit: 5120,
                name: 'assets/[hash:8].[name].[ext]',
                esModule: false,
              },
            },
          ],
        },
      ],
    },
    plugins: [
      new CleanWebpackPlugin(),
      new HtmlWebpackPlugin({ template: './public/index.html' }),
      ...(!isDev
        ? [
            new MiniCssExtractPlugin({
              filename: '[name].[contenthash:8].css',
            }),
          ]
        : []),
    ],
    optimization: isDev
      ? {}
      : {
          minimizer: [new TerserPlugin(), new OptimizeCSSAssetsPlugin()],
        },
    devServer: {
      port: process.env.PORT ? Number(process.env.PORT) : 8092,
      hot: true,
      open: false,
      publicPath: '/',
      historyApiFallback: true,
    },
    devtool: isDev ? 'cheap-module-eval-source-map' : false,
  };
};
