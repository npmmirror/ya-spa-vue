/**
 * 工具库
 * 引入方式 import utils from '@/deps/utils';
 * @module utils
 */
import {
  Vue
} from './env';
import axios from 'axios';
import {
  merge
} from 'lodash';
import hook from './hook';
import clientStore from 'store';
import errorCode from './error-code.js'; // 错误码映射

/**
 * @constant
 * @type {String}
 * @default
 */
export const BASE_PATH = '/'; // 总是相对于html
let apiDomain = window.API_DOMAIN || '/';
if (apiDomain.slice(-1) !== '/') {
  apiDomain = apiDomain + '/';
}
if (apiDomain !== '/') {
  // 考虑附加请求协议
  if (apiDomain.slice(0, 4) !== 'http') {
    apiDomain = location.protocol + '//' + apiDomain;
  }
}
export const API_DOMAIN = apiDomain; // 接口域名
/**
 * 判断value是否为函数类型
 * @param {*} value - The data
 * @return {Boolean} - true/false
 */
export const isFunction = function (value) {
  return Object.prototype.toString.call(value) === '[object Function]';
};
/**
 * 前后端异步通信接口
 * @param {Object} ajaxOptions - axios config
 * @param {Object} options - 自定义配置项
 * @param {Boolean} [options.mask = true] - 请求是否带遮罩
 * @param {String} [options.ajaxType = 'ignore'] - 防止二次提交 ignore(等上次请求完才能发请求)/abort(直接中断上次请求)/none(可发多个相同请求)
 * @param {Boolean} [options.withData = true] - 在ajaxType不等于none时起作用，作为二次提交的判定条件，是否连带提交参数判定
 * @param {Boolean} [options.autoApplyUrlPrefix = true] - 自动附加请求前缀
 * @param {Boolean} [options.silentError = false] - 默认提示错误
 * @param {Boolean} [options.forceMock = false] - 是否强制走本地mock服务
 * @param {Boolean} [options.autoTry = false] - 是否是自动发起的请求尝试
 * @param {Boolean} [options.customCallback = false] - 是否自定义callback
 * @param {Boolean} [options.callbackCoverServer = false] - onError/onCallback是否覆盖server error
 * @return {Promise} Ajax handler
 */
export const c2s = (() => {
  var ajaxSources = []; // 存储ajax取消token存储
  // https://github.com/axios/axios/issues/265 IE 8-9
  axios.interceptors.response.use((response) => {
    if (response.data == null && response.config.responseType === 'json' && response.request.responseText != null) {
      try {
        // eslint-disable-next-line no-param-reassign
        response.data = JSON.parse(response.request.responseText);
      } catch (e) {
        // ignored
      }
    }
    return response;
  });

  return (ajaxOptions, {
    mask = true,
    ajaxType = 'ignore',
    withData = true,
    autoApplyUrlPrefix = true,
    silentError = false,
    forceMock = false,
    autoTry = false,
    customCallback = false,
    callbackCoverServer = false
  } = {}) => {
    const appMethods = getAppStore('methods');
    const alert = appMethods.alert; // 业务层存储alert引用
    const showIndicator = appMethods.showIndicator || (() => {}); // 显示加载指示器
    const hideIndicator = appMethods.hideIndicator || (() => {}); // 隐藏加载指示器
    let url = ajaxOptions.url;
    const originUrl = url; // 保存原始请求地址
    if (autoApplyUrlPrefix) {
      let apiPrefix = window.__api_prefix__; // 附加自定义前缀
      if (apiPrefix) {
        if (apiPrefix.slice(-1) !== '/') {
          apiPrefix = apiPrefix + '/';
        }
        url = apiPrefix + url;
      }
      ajaxOptions.url = API_DOMAIN + url;
    }
    if (ajaxOptions.url.slice(0, 4) === 'http' && typeof ajaxOptions.withCredentials === 'undefined') {
      ajaxOptions.withCredentials = true; // 默认支持跨域cookie
    }
    // 默认post方式
    ajaxOptions.method = ajaxOptions.method || 'post';
    // 返回值默认json
    ajaxOptions.responseType = ajaxOptions.responseType || 'json';
    // ajaxOptions.headers = {
    //   'Content-Type': 'application/x-www-form-urlencoded'
    // }
    // 可继承通过setAppData设置的入参
    let defaultRequestData = getAppData('$defaultRequestData');
    if (isFunction(defaultRequestData)) {
      defaultRequestData = defaultRequestData({
        ...ajaxOptions
      });
    }
    if (!defaultRequestData) { // == false的情况
      defaultRequestData = {};
    }
    let data = ajaxOptions.data || {
      header: null,
      body: {}
    };
    data.header = {
      app: '',
      // pageSize: 20,
      // pageNum: 1,
      ...(data.header || {})
    };
    // 浅覆盖
    if (defaultRequestData && defaultRequestData.header) {
      data.header = {
        ...defaultRequestData.header,
        ...data.header
      };
    }
    if (typeof data.body === 'undefined') {
      data.body = {};
    }
    // 浅覆盖
    if (defaultRequestData && defaultRequestData.body) {
      data.body = {
        ...defaultRequestData.body,
        ...data.body
      };
    }
    // data过滤string参数类型的前后空格
    const dataMainKeys = ['header', 'body'];
    dataMainKeys.forEach((k) => {
      const typeofStr = Object.prototype.toString.call(data[k]);
      if (typeofStr === '[object Object]') { // 只过滤第一层对象
        data[k] = Object.keys(data[k]).reduce((pv, cv) => {
          let value = data[k][cv]
          if (typeof value === 'string') {
            value = value.trim()
          }
          pv = {
            ...pv,
            [cv]: value
          }
          return pv;
        }, {});
      }
    });
    const pathPrefixOnDebug = forceMock ? 'mock' : getProxyPrefix(); // 测试环境下的请求路径前缀
    // 带有ignoreMock字段的接口不添加mock前缀 zhaoyao
    if (isDevelop() && !ajaxOptions.ignoreMock) {
      // 默认从rap上拉数据
      ajaxOptions.url = '/' + pathPrefixOnDebug + '/' + url;
      //
      let pathPrefix = getRequestIgnorePrefix();
      if (pathPrefix) {
        pathPrefix = pathPrefix.split(',');
        let tempUrl = ajaxOptions.url.split('/');
        tempUrl = tempUrl.filter((flagment) => {
          if (pathPrefix.indexOf(flagment) === -1) {
            return true;
          }
        });
        ajaxOptions.url = tempUrl.join('/');
      }
    } else {
      delete ajaxOptions.ignoreMock
      delete data.projectId;
    }
    // 重新指回
    ajaxOptions.data = data;

    let maskElement = null;
    let isRefStatic = false;
    let refElement = null;
    const cancelSource = axios.CancelToken.source();
    // 遮罩处理
    if (mask === true) { // 全局遮罩共用一个遮罩
      // 全屏遮罩
      showIndicator();
      maskElement = document.getElementById('app-ajax-global-mask');
      if (!maskElement) {
        maskElement = document.createElement('div');
        maskElement.id = 'app-ajax-global-mask';
        maskElement.className = 'app-ajax-mask app-ajax-global-mask';
        maskElement.style.display = 'none';
        maskElement.style.position = 'fixed';
        maskElement.style.top = '0';
        maskElement.style.left = '0';
        maskElement.style.width = '100%';
        maskElement.style.height = '100%';
        maskElement.style.zIndex = 10010;
        // maskElement.style.background = 'red';
        maskElement.innerHTML = '<div class="app-ajax-mask-inner"></div>';
        if (document.body) { // Fuck flow
          document.body.appendChild(maskElement);
        }
      }
    } else if (mask instanceof Vue) { // 局部遮罩，要求root element拥有定位，否则给予警告
      refElement = mask.$el;
      const style = window.getComputedStyle(refElement);
      if (style.position === 'static') {
        console.warn('被定位element position === static，数据请求过程中可能会产生布局错乱');
        refElement.style.position = 'relative';
        isRefStatic = true;
      }
      maskElement = document.createElement('div');
      maskElement.className = 'app-ajax-mask app-ajax-part-mask';
      maskElement.style.display = 'none';
      maskElement.style.position = 'absolute';
      maskElement.style.width = refElement.offsetWidth;
      maskElement.style.height = refElement.offsetHeight;
      refElement.appendChild(maskElement);
      // 关联vue component，destroy后abort请求
      mask.$once('destroyed', () => {
        cancelSource.cancel('abort');
      })
    }
    if (maskElement) {
      maskElement.style.display = 'block';
    }
    // 重复请求处理
    ajaxOptions.cancelToken = cancelSource.token;
    if (ajaxType === 'abort' || ajaxType === 'ignore') {
      let isIgnore = false;
      ajaxSources.some((source) => {
        if (ajaxOptions.url === source.url &&
          (!withData || (withData && JSON.stringify(ajaxOptions.data) === JSON.stringify(source.data)))) { // 带请求参数判定和不带请求参数判定
          if (ajaxType === 'abort') {
            source.cancel('abort');
          } else {
            isIgnore = true;
          }
          return true;
        }
      })
      if (isIgnore) { // 需要等待的请求直接返回，不做任何操作
        return Promise.reject('ignore');
      }
    }
    // 存储ajax资源
    ajaxSources.push({
      cancel: cancelSource.cancel,
      url: ajaxOptions.url,
      data: ajaxOptions.data,
      cancelToken: ajaxOptions.cancelToken
    });
    // 清理ajax source
    const clearAjaxSource = function () {
      ajaxSources = ajaxSources.filter((source) => {
        return source.cancelToken !== ajaxOptions.cancelToken
      });
    };
    // 清理mask
    const clearMask = function () {
      if (!ajaxSources.length) { // 没有进行中的xhr才取消遮罩
        hideIndicator();
      }
      if (maskElement) {
        if (mask === true) {
          maskElement.style.display = 'none';
        } else {
          if (maskElement.parentNode) { // Fuck flow
            maskElement.parentNode.removeChild(maskElement);
          }
          // 恢复static定位
          if (isRefStatic && refElement) {
            refElement.style.position = 'static';
          }
        }
      }
    };
    let onSuccess = ajaxOptions.onSuccess || (() => {});
    let onError = ajaxOptions.onError || (() => {});
    let onCallback = ajaxOptions.onCallback || (() => {});
    if (autoTry) { // 自动发起的尝试请求不响应用户逻辑
      onSuccess = onError = () => {};
    }
    /**
     * 获取返回信息
     */
    const getResMessage = (header) => {
      return errorCode[header.code] || header.message || '系统开小差了！';
    };
    const ajaxPromise = new Promise((resolve, reject) => {
      /**
       * axios resolve回调处理
       * @param {Object} response - 返回响应
       */
      const axiosResolveCallback = async function (response) {
        const data = response.data;
        if (customCallback) {
          onCallback(data);
          clearAjaxSource();
          clearMask();
        } else {
          if (ajaxOptions.responseType === 'json') {
            const header = data.header;
            if (header.code !== 10000 && header.code !== '10000' && header.code !== 20000) { // 10000 是成功状态码
              let isSilent = silentError;
              if (Object.prototype.toString.call(silentError) === '[object Function]') {
                isSilent = silentError(data);
              }
              if (!isSilent) { // 业务错误自动提示
                if (alert) {
                  alert({
                    message: getResMessage(header),
                    iconType: 'error'
                  });
                } else {
                  window.alert(getResMessage(header));
                }
              }
              header.success = false;
              onError(data);
              reject(data);
            } else {
              header.success = true;
              onSuccess(data);
              resolve(data);
            }
          } else {
            onSuccess(data);
            resolve(data);
          }
          clearAjaxSource();
          clearMask();
        }
        // hook响应
        await hook.exe('response@ajax', {
          data: response,
          type: 'success'
        });
      };
      /**
       * reject handler
       * @param {Object} err - error
       */
      const axiosRejectCallback = async function (err) {
        let isSilent = silentError;
        if (Object.prototype.toString.call(silentError) === '[object Function]') {
          isSilent = silentError(err);
        }
        if (err.response) {
          const response = err.response;
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          // debug模式下尝试走一遍本地mock服务，用于应对远程服务接口不全的情况
          let data = null;
          if (typeof response.data === 'string') {
            data = {
              header: {
                code: 0,
                message: response.data
              }
            };
          } else {
            data = response.data || {
              header: {
                code: 0,
                message: response.status + ' ' + response.statusText
              }
            };
          }
          const header = data.header;
          if (isDevelop() && pathPrefixOnDebug !== 'mock') {
            console.error('提示', '测试服务期接口返回500错误，尝试走本地mock服务重调一次');
            c2s({
              ...ajaxOptions,
              url: originUrl
            }, {
              mask,
              ajaxType,
              withData,
              autoApplyUrlPrefix,
              silentError,
              forceMock: true,
              autoTry: true
            }).then((response) => {
              axiosResolveCallback({
                data: response
              });
            });
            if (!isSilent) {
              if (alert) {
                alert({
                  message: getResMessage(header),
                  iconType: 'error'
                });
              } else {
                window.alert(getResMessage(header));
              }
            }
          } else {
            // if (header.code === 50001 || header.code === '50001') { // 业务错误
            if (!isSilent) {
              if (alert) {
                alert({
                  message: getResMessage(header),
                  iconType: 'error'
                });
              } else {
                window.alert(getResMessage(header));
              }
            }
            // }
          }
        } else if (err.request) {
          // The request was made but no response was received
          // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
          // http.ClientRequest in node.js
          console.log(err);
        } else {
          // Something happened in setting up the request that triggered an Error
          console.log('Error', err);
        }
        if (callbackCoverServer) {
          if (customCallback) {
            onCallback(err);
          } else {
            onError(err);
          }
          reject(err);
        }
        clearAjaxSource();
        clearMask();

        // hook响应
        await hook.exe('response@ajax', {
          data: err,
          type: 'error'
        });
      };
      // 执行ajax
      axios(ajaxOptions).then((response) => {
        axiosResolveCallback(response);
      }).catch((err) => {
        axiosRejectCallback(err);
      });
    });
    ajaxPromise.catch(() => {});
    return ajaxPromise;
  }
})();
/**
 * 封装c2s方法，请求数据缓存层
 * ds === dataset
 * @param {Boolean} [strictMode = false] - 严格模式
 * @param {Boolean} [cache = false] - 是否缓存
 * @param {Boolean} [localstorage = false] - 是否加入本地存储
 * @param {String} [prefer = 'backward'] - backward/forward(走缓存/走接口)
 * @param {Array} [transform = []] - 返回值转换器
 */
export const ds = (() => {
  return function (options = {}) {
    // localStorage === -1/1 代表按cacheStore从后存，从前存
    const { strictMode = false, cache = false, localStorage = false } = options;
    const historyLength = 1 // 只保留最近一次数据记录，暂不做可配选项，未发现对应需求
    const prefer = 'backward'; // 优先取历史数据，没取到再走接口，对比forward，直接取值
    const transform = [].concat(options.transform || []); // 变换器
    const url = options.url;
    var cacheStore = []; // 存储响应结果
    var promise = null; // 保留最近一次请求promise
    var lastData = null; // 保留最近一次请求data，用来在兼容模式下判定是否要重新发起请求
    if (!url) {
      console.error('ds配置参数url不能为空');
      return;
    }
    return function (ajaxOptions, customOptions = {}) {
      const { data = {} } = ajaxOptions;
      const dataCopy = {
        ...data
      };
      // 重设请求地址
      ajaxOptions.url = url;
      // 从localStorage里取数据填充内存
      const fillCacheStore = () => {
        // 只填充一次
        if (fillCacheStore.isFilled || localStorage === false) {
          return;
        }
        let localDs = clientStore.get('ds') || [];
        localDs.some((item) => {
          if (item.url === url) {
            cacheStore = item.cacheStore;
            return true;
          }
        });
        fillCacheStore.isFilled = true;
      };
      const end = () => {
        // 释放promise引用
        promise = null;
      };
      const doTransform = (res) => {
        const callTransform = transform.concat(customOptions.transform || []);
        // res流过transform
        res = callTransform.reduce((pv, cv) => {
          return cv(pv);
        }, res);
        return res;
      };
      const doPromise = (resolve, reject) => {
        c2s(ajaxOptions, customOptions).then((res) => {
          res = doTransform(res);
          // 返回值
          var result = {
            res
          };
          // 缓储响应数据
          if (cache) {
            if (!cacheStore.some((item) => {
              if (item.req.url === url && JSON.stringify(item.req.data) === JSON.stringify(dataCopy)) {
                item.res.push(res);
                // 保留有限长度
                item.res = item.res.slice(-historyLength);
                return true;
              }
            })) {
              cacheStore.push({
                req: {
                  url,
                  data: dataCopy // 保存data copy版防止被完善结构
                },
                res: [res]
              });
            }
            result.cacheStore = cacheStore;
            // 处理本地存储
            if (localStorage !== false) {
              let localDs = clientStore.get('ds') || [];
              // 获取待填充的本地数据
              let getLocalDs = (cacheStore) => {
                if (localStorage === true) {
                  return cacheStore;
                } else {
                  if (localStorage > 0) {
                    return cacheStore.slice(0, localStorage);
                  } else {
                    return cacheStore.slice(localStorage);
                  }
                }
              };
              if (!localDs.some((item) => {
                if (item.url === url) {
                  item.cacheStore = getLocalDs(cacheStore);
                  return true;
                }
              })) { // 没找到新加入
                localDs.push({
                  url,
                  cacheStore: getLocalDs(cacheStore)
                });
              }
              // 重新存储
              clientStore.set('ds', localDs);
            }
          }
          // resolve
          resolve(result);
          end();
        }).catch((err) => {
          reject(err);
          end();
        });
      };
      if (!cache) { // 非缓存模式
        if (strictMode) { // 严格模式下，调用几次就发送几次请求
          promise = new Promise((resolve, reject) => {
            doPromise(resolve, reject);
          });
        } else { // 兼容模式下(strictMode === false)，防止同时多次调用
          if (!promise) {
            promise = new Promise((resolve, reject) => {
              doPromise(resolve, reject);
            });
          } else {
            if (JSON.stringify(lastData) !== JSON.stringify(dataCopy)) {
              promise = new Promise((resolve, reject) => {
                doPromise(resolve, reject);
              });
            }
          }
        }
      } else { // 缓存模式
        fillCacheStore(); // 先填充本地缓存
        const callPrefer = customOptions.prefer || prefer;
        const handlePromise = () => {
          if (callPrefer === 'backward') {
            const cacheItem = cacheStore.find((item) => {
              return item.req.url === url && JSON.stringify(item.req.data) === JSON.stringify(dataCopy);
            });
            if (!cacheItem) { // 未找到缓存走api请求
              promise = new Promise((resolve, reject) => {
                doPromise(resolve, reject);
              });
            } else {
              promise = new Promise((resolve, reject) => {
                resolve({
                  res: cacheItem.res[cacheItem.res.length - 1],
                  cacheStore: cacheStore
                });
                end();
              });
            }
          } else if (callPrefer === 'forward') {
            promise = new Promise((resolve, reject) => {
              doPromise(resolve, reject);
            });
          }
        };
        if (strictMode) { // 严格模式下，各自判定，互相独立
          handlePromise();
        } else { // 兼容模式
          if (!promise) { // promise不存在，backward/forward分别对待
            handlePromise();
          } else { // 兼容模式下，如果promise存在，backward和forward行为一致，取当前promise返回值
            if (JSON.stringify(lastData) !== JSON.stringify(dataCopy)) {
              promise = new Promise((resolve, reject) => {
                doPromise(resolve, reject);
              });
            }
          }
        }
      }
      lastData = dataCopy; // 保留请求参数引用
      return promise;
    };
  };
})();
/**
 * 获取地址对应查询参数值
 * @param {String} key - Query key
 * @return {String} Value
 */
export const getUrlQueryValue = function (key) {
  const search = location.search;
  var value;
  if (search) {
    search.slice(1).split('&').some((fragment) => {
      const arr = fragment.split('=');
      if (arr[0] === key) {
        value = arr[1];
        return true;
      }
    });
  }
  return value;
};

/**
 * 获取平台名（内部根据platformName参数值判定）
 * @return {String} 平台名
 */
export const getPlatformName = function () {
  const platformName = getUrlQueryValue('platformName') || 'pc'; // 默认pc平台
  return platformName;
};

/**
 * 获取页面title（内部根据title query param返回）
 * @return {Stirng} 页面title
 */
export const getDocumentTitle = function () {
  const title = getUrlQueryValue('title') || ''; // Document title
  return title;
};

/**
 * 设置Document title
 * @param {String} title Document title
 */
export const setDocumentTitle = function (title) {
  document.getElementsByTagName('title')[0].innerHTML = title;
  window.AlipayJSBridge && window.AlipayJSBridge.call('setTitle', { // 支付宝修改title的方式
    title: title
  });
};

/**
 * 根据ignorePrefix查询参数获取请求需要忽略的访问路径
 * @return {String} 路径
 */
export const getRequestIgnorePrefix = function () {
  const pathPrefix = getUrlQueryValue('ignorePrefix') || ''; // 二级目录路径
  return pathPrefix;
};

/**
 * 根据请求参数或者访问地址判断是否处于develop状态
 * 开发环境包括127.0.0.1/localhost/192.168.x.x（不包括192.168.49.61）
 * @return {Boolean} true/false
 */
export const isDevelop = function () {
  const debugValue = getUrlQueryValue('develop') || '';
  if (debugValue !== '') {
    return !!(debugValue / 1);
  } else { // 根据访问地址判断
    const hostname = location.hostname;
    // 本地或者非61的局域网段都认为是开发模式
    if (hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      (hostname.slice(0, 7) === '192.168' && hostname !== '192.168.49.61')
    ) {
      return true;
    } else {
      return false;
    }
  }
};

/**
 * 获取当前代理数据请求地址前缀
 * @return {String} ?proxy="返回值"
 */
export const getProxyPrefix = function () {
  const prefix = getUrlQueryValue('proxy') || 'mock'; // 代理前缀
  return prefix;
};
/**
 * 手动地址跳转
 * @param {Object} options - $router.push(options)
 */
export const jumpTo = function (options) {
  const router = getAppStore('router');
  if (typeof options === 'number') {
    router.go(options);
  } else {
    router.push(options);
  }
};

/**
 * sessionStorage操作
 * @param {String} key - key
 * @param {*} value - value，当value为undefined时为getter操作，否则为setter
 * @return {*} value
 */
export const sessionStorage = function (key, value) {
  var result;
  if (window.sessionStorage) {
    const sessionStorage = window.sessionStorage;
    if (value === undefined) {
      let temp = sessionStorage.getItem(key);
      try {
        const firstChar = temp.slice(0, 1);
        if (firstChar === '{' || firstChar === '[') {
          result = JSON.parse(temp);
        } else {
          result = temp;
        }
      } catch (evt) {
        result = temp;
      }
    } else {
      if (typeof value === 'string') {
        result = sessionStorage.setItem(key, value);
      } else {
        result = sessionStorage.setItem(key, JSON.stringify(value));
      }
    }
  }
  return result;
};

/**
 * localStorage操作
 * 基于 https://github.com/marcuswestin/store.js/ 实现
 * @param {String} key - key
 * @param {*} value - value，当value为undefined时为getter操作，否则为setter
 * @return {*} value
 */
export const localStorage = function (key, value) {
  var result;
  if (value === undefined) { // getter
    result = clientStore.get(key);
  } else {
    result = clientStore.set(key, value);
  }
  return result;
};

// 设置app命名空间占用
var appStore = {
  methods: {}, // 存储不同平台同一方法实现
  data: null, // 业务数据存储
  store: null, // vuex
  router: null // vue-router
};
/**
 * 获取app store
 * @param {String} key - 要获取的key
 * @return {*} value
 */
export const getAppStore = function (key) {
  return appStore[key];
};

/**
 * 设置app store， Deep merge方式
 * @param {String} key - key
 * @param {*} value - value
 * @return {*} value
 */
export const setAppStore = function (key, value) {
  appStore[key] = value;
  return value;
};

/**
 * 获取app data
 * @param {String} key - key
 * @return {*} value
 */
export const getAppData = function (key) {
  const appData = getAppStore('data');
  return appData[key];
};

/**
 * 设置app data
 * @param {String} key - key
 * @param {*} value - value
 * @return {*} value
 */
export const setAppData = function (key, value) {
  const appData = getAppStore('data');
  var newValue;
  if (Object.prototype.toString.call(appData[key]) === '[object Object]' && Object.prototype.toString.call(value) === '[object Object]') {
    newValue = merge({}, appData[key], value);
  } else if (Object.prototype.toString.call(appData[key]) === '[object Array]' && Object.prototype.toString.call(value) === '[object Array]') {
    newValue = appData[key].concat(value);
  } else {
    newValue = value;
  }
  appData[key] = newValue;
  setAppStore('data', appData);
  return newValue;
};
/**
 * 清除app data
 * @param {String} key - key
 * @return {*} value
 */
export const removeAppData = function (key) {
  const appData = getAppStore('data');
  const value = appData[key];
  delete appData[key];
  setAppStore('data', appData);
  return value;
};
/**
 * 生成唯一id
 * @return {String} uuid
 */
export const generateID = function () {
  return 'x' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

/**
 * 自定义log屏幕打印
 * @param {String} message - log message
 * @param {String} [pattern = 'append'] - 信息显示方式：append（追加到上一条后面）; clear（先清屏）
 */
export const log = function (message, pattern) {
  pattern = pattern || 'append';
  let logDom = document.getElementById('app-log');
  let bodyDom = null;
  let closeHandlerDom = null;
  if (!logDom) {
    logDom = document.createElement('div');
    bodyDom = document.createElement('div');
    logDom.id = 'app-log';
    bodyDom.className = 'log-body';
    Object.assign(logDom.style, {
      display: 'none',
      position: 'fixed',
      top: 0,
      left: 0,
      width: '80%',
      'margin-left': '10%',
      // 'padding-top': '16px',
      'z-index': '100000',
      background: 'white',
      border: '1px solid #cccccc',
      'box-shadow': '0px 4px 8px #444444',
      'font-size': '16px'
    });
    Object.assign(bodyDom.style, {
      overflow: 'auto',
      'max-height': '300px'
    });
    closeHandlerDom = document.createElement('span');
    Object.assign(closeHandlerDom.style, {
      position: 'absolute',
      top: '2px',
      right: '16px',
      cursor: 'pointer',
      'font-size': '1.5em',
      'line-height': '1em'
    });
    closeHandlerDom.addEventListener('click', () => {
      logDom.style.display = 'none';
    });
    closeHandlerDom.innerHTML = '&times;';

    logDom.appendChild(bodyDom);
    document.body.appendChild(logDom);
    logDom.appendChild(closeHandlerDom);
  } else {
    bodyDom = logDom.querySelector('.log-body');
  }
  logDom.style.display = 'block';
  let messageDom = document.createElement('p');
  Object.assign(messageDom.style, {
    'border-bottom': '1px solid #444444',
    'padding': '4px 8px'
  });
  messageDom.innerHTML = message;
  if (pattern === 'clear') {
    logDom.innerHTML = '';
  }
  bodyDom.appendChild(messageDom);
};

/**
 * 获取window scrollTop
 * @return {Number} scrollTop值
 */
export const getWindowScrollTop = function () {
  return document.body.scrollTop + document.documentElement.scrollTop;
};

/**
 * 回到顶部
 */
export const gotoWinTop = function () {
  window.scrollTo(0, 0);
};
/**
 * 异步加载js
 * @param {(String|String[])} deps - 要加载的js列表
 * @param {Function} callback - 加载后回调
 */
export const asyncLoadJs = (function () {
  var store = []; // 存储加载后的依赖JS库信息
  return function (deps, callback) {
    // TODO: 考虑Async机制
    deps = [].concat(deps);
    run(function*() {
      let dep = deps.shift();
      let flag = true;
      while (dep && flag) {
        flag = yield create(dep);
        dep = deps.shift();
      }
    }, callback);
    /**
     * 执行器
     * @param  {*}   genFn
     * @param  {*} callback
     * @return {*}
     */
    function run(genFn, callback) {
      var gen = genFn();

      function next(data) {
        var r = gen.next(data);
        if (r.done) {
          callback && callback(true);
          return;
        }
        r.value.then(function (data) {
          next(data);
        }).catch(function (data) {
          next(false);
          callback && callback(false, data);
        });
      }
      next();
    }
    /**
     * 异步按序执行，返回一个Promise对象
     * @param  {*} url
     * @return {*}
     */
    function create(url) {
      if (url.slice(0, 1) !== '/' && url.slice(0, 4) !== 'http') {
        url = BASE_PATH + url;
      }
      var data = store.find((itemData) => {
        return itemData.url === url;
      });
      var p;
      if (!data) {
        p = new Promise(function (resolve, reject) {
          var scriptDom = document.createElement('script');
          scriptDom.src = url;
          scriptDom.onload = scriptDom.onreadystatechange = function () {
            if (!this.readyState || this.readyState === 'loaded' || this.readyState === 'complete') {
              this.onload = this.onreadystatechange = null;
              // 都成功执行回调
              resolve(url);
            }
          };
          scriptDom.onerror = function () {
            reject(url);
          };
          document.getElementsByTagName('head')[0].appendChild(scriptDom);
        });
        store.push({
          url: url,
          promise: p
        });
      } else {
        p = data.promise;
      }
      return p;
    }
  };
}());

/**
 * 异步加载css
 * @param {(String|String[])} deps - 要加载的js列表
 * @param {Function} callback - 加载后回调
 */
export const asyncLoadCss = (function () {
  var store = {};
  return function (deps, callback) {
    deps = [].concat(deps);
    Promise.all(deps.map((dep) => {
      let url = '';
      if (dep.slice(0, 1) !== '/' && dep.slice(0, 4) !== 'http') {
        url = BASE_PATH + dep;
      } else {
        url = dep;
      }
      let p = store[url];
      if (!p) {
        p = new Promise(function (resolve, reject) {
          let linkDom = document.createElement('link');
          linkDom.rel = 'stylesheet';
          linkDom.type = 'text/css';
          linkDom.href = url;
          document.getElementsByTagName('head')[0].appendChild(linkDom);
          linkDom.onload = function () {
            resolve();
          };
          linkDom.onerror = function () {
            reject();
          };
        });
        store[url] = p;
      }
      return p;
    })).then(function () {
      callback();
    }).catch(function (evt) {
      console.log(evt);
    });
  }
}());
/**
 * 组件创建转换器
 * @param {Function} originComponent - 组件创建器
 */
export const vueCtorTransformer = function (originComponent) {
  return () => {
    return new Promise((resolve) => {
      async function asyncFnCreate() {
        const param = await hook.exe('create@component', {});
        originComponent(resolve, param);
      }
      if (typeof originComponent === 'function') { // 只处理返回值是function的情况
        asyncFnCreate();
      } else {
        resolve(originComponent);
      }
    });
  };
};

/**
  * 获得输入框光标位置
  * @param {Element} inputDom - :text/textarea element ref
  * @returns {{text: string, start: number, end: number}}
  */
export const getCursorPosition = function (inputDom) {
  var rangeData = {
    text: '',
    start: 0,
    end: 0
  };
  inputDom.focus(); // 重复设置textarea focus在ie下会导致window.scroll定位错乱，所有保证最多设置一次
  if (inputDom.setSelectionRange) { // W3C
    rangeData.start = inputDom.selectionStart;
    rangeData.end = inputDom.selectionEnd;
    rangeData.text = (rangeData.start !== rangeData.end)
      ? inputDom.value.substring(rangeData.start, rangeData.end)
      : '';
  } else if (document.selection) { // IE
    var i;
    var oS = document.selection.createRange();
    var oR = document.body.createTextRange();
    oR.moveToElementText(inputDom);
    rangeData.text = oS.text;
    rangeData.bookmark = oS.getBookmark();
    // object.moveStart(sUnit [, iCount])
    // Return Value: Integer that returns the number of units moved.
    for (i = 0; oR.compareEndPoints('StartToStart', oS) < 0 && oS.moveStart('character', -1) !== 0; i++) {
      // Why? You can alert(inputDom.value.length)
      if (inputDom.value.charAt(i) === '\n') {
        i++;
      }
    }
    rangeData.start = i;
    rangeData.end = rangeData.text.length + rangeData.start;
  }
  return rangeData;
};
/**
* 设置输入框光标位置
* @param {Element} inputDom - :text/textarea element ref
* @param rangeData
*/
export const setCursorPosition = function (inputDom, rangeData) {
  var start,
    end;
  if (!rangeData) {
    alert('必须定义光标位置');
    return false;
  }
  start = rangeData.start;
  end = rangeData.end;

  if (inputDom.setSelectionRange) { // W3C
    inputDom.focus(); // 重复设置textarea focus在ie下会导致window.scroll定位错乱，所有保证最多设置一次
    inputDom.setSelectionRange(start, end);
  } else if (inputDom.createTextRange) { // IE
    var oR = inputDom.createTextRange();

    // Fix IE from counting the newline characters as two seperate characters
    var breakPos,
      i;
    // 设置断点位置
    breakPos = start;
    for (i = 0; i < breakPos; i++) {
      if (inputDom.value.charAt(i).search(/[\r\n]/) !== -1) {
        start = start - 0.5;
      }
    }
    // 设置断点位置
    breakPos = end;
    for (i = 0; i < breakPos; i++) {
      if (inputDom.value.charAt(i).search(/[\r\n]/) !== -1) {
        end = end - 0.5;
      }
    }

    oR.moveEnd('textedit', -1);
    oR.moveStart('character', start);
    oR.moveEnd('character', end - start);
    oR.select();
  }
};
/**
 * 将内容追加到光标的位置，并保持光标位置不动
 * @param {Element} inputDom - :text/textarea element ref
 * @param text
 */
export const appendTextAtCursor = function (inputDom, text) {
  var val = inputDom.value;
  var rangeData = getCursorPosition(inputDom);
  inputDom.value = val.slice(0, rangeData.start) + text + val.slice(rangeData.end);
  // 重设光标位置
  setCursorPosition(inputDom, Object.assign(rangeData, {
    start: rangeData.start + text.length,
    end: rangeData.start + text.length
  }));
};
/**
 * 焦点至于输入框最后
 * @param {Element} inputDom - :text/textarea element ref
 */
export const focusAtLast = function (inputDom) {
  var val = inputDom.value;
  setCursorPosition(inputDom, {
    start: val.length,
    end: val.length
  });
};
