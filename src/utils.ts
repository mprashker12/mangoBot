import { SSL_OP_SSLEAY_080_CLIENT_DH_BUG } from "constants";

export async function delay(ms : number) {
    return new Promise((res) => {
        setTimeout(res, ms);
    })
}

export function mean(arr : number[]) {
    const n = arr.length;
    if(n === 0) {
        throw Error("Trying to compute mean of array of length 0");
    }
    let sum = 0;
    for(const elem of arr) {
        sum += elem;
    }
    return sum/n;
}

export function std(arr : number[]) {
    const n = arr.length;
    if(n === 0) {
        throw Error("Trying to compute the standard deviation of an array of length 0");
    }
    let average = mean(arr);
    let squared_diffs = 0;
    for(const elem of arr) {
        squared_diffs += (elem - average)*(elem - average);
    }
    return Math.sqrt(squared_diffs/n);
}