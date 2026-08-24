import {
    createCanvas,
    loadImage
} from '@napi-rs/canvas';


import {
    processTexture,
    createBaseTexture,
    buildFinalCanvas,
    applyScale,
    getAverageColor,
    outlineGenerators,
    bgGenerators,
    resolveOutlineColor,
    resolveBgColor
} from './main.js';



export {
    processTexture,
    createBaseTexture,
    buildFinalCanvas,
    applyScale,
    getAverageColor,
    outlineGenerators,
    bgGenerators,
    resolveOutlineColor,
    resolveBgColor
};


/**
 * Node环境快捷入口
 */
export async function processTextureFile(
    filePath,
    options = {}
) {

    const image = await loadImage(filePath);

    return processTexture(
        image,
        {
            ...options,
            createCanvas
        }
    );
}


export {
    createCanvas,
    loadImage
};