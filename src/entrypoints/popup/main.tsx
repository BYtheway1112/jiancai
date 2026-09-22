import React from 'react';
import {createRoot} from 'react-dom/client';
import {browser} from 'wxt/browser';
import {rpc} from '../../collector/rpc';
import {Popup} from './Popup';
createRoot(document.getElementById('root')!).render(<Popup services={{call:rpc,openSettings:()=>browser.runtime.openOptionsPage(),close:()=>window.close()}}/>);
